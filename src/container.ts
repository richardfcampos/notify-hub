/**
 * Composition root (design Component 1): the single place concrete
 * implementations are instantiated and wired. Production opens the SQLite DB
 * at `config.dbPath`, builds the channel/profile repositories over it, runs
 * the one-time seed-from-.env migration, and wires dispatch/delivery/api on
 * those repositories (so config is read live from the DB -> hot-reload).
 * Tests pass `overrides` to inject fakes (InMemoryQueue, in-memory repos,
 * fake http/mail) and drive the whole pipeline without SQLite/Redis/SMTP.
 * Exposes the queue, the server deps, worker registration, and a close()
 * that shuts the queue AND the DB down.
 *
 * Also fires the anonymous opt-in boot heartbeat (TEL-01/02/03) once here so
 * BOTH api and worker entrypoints get it for free from this single shared
 * boot helper (DRY) -- fire-and-forget, never awaited, any rejection
 * swallowed so a PostHog outage can never delay or crash boot.
 */
import type Database from 'better-sqlite3'
import pino from 'pino'
import type { ServerDeps } from './api/server.js'
import type {
  ChannelRepository,
  Clock,
  HttpClient,
  Logger,
  MailTransport,
  ProfileRepository,
  QueuePort
} from './core/ports.js'
import type { AppConfig, ChannelDeps } from './core/types.js'
import { openDatabase } from './db/database.js'
import { seedFromEnvIfEmpty } from './db/seed-from-env.js'
import { SqliteChannelRepository } from './db/sqlite-channel-repository.js'
import { SqliteProfileRepository } from './db/sqlite-profile-repository.js'
import { getOrCreateInstallId } from './db/sqlite-telemetry-repository.js'
import { DeliveryService } from './delivery/delivery-service.js'
import { DispatchService } from './dispatch/dispatch-service.js'
import { FetchHttpClient } from './http/fetch-http-client.js'
import { BullMqQueue } from './queue/bullmq-queue.js'
import { buildTelemetryClient } from './telemetry/build-telemetry-client.js'
import { NoopTelemetryClient } from './telemetry/noop-telemetry-client.js'
import { readPackageVersion } from './telemetry/read-package-version.js'
import type { TelemetryPort } from './telemetry/telemetry-port.js'
import { NodemailerTransport } from './transports/nodemailer-transport.js'

export interface ContainerOverrides {
  queue?: QueuePort
  channelRepo?: ChannelRepository
  profileRepo?: ProfileRepository
  http?: HttpClient
  mail?: MailTransport
  clock?: Clock
  logger?: Logger
  telemetryClient?: TelemetryPort
}

export interface Container {
  queue: QueuePort
  buildServerDeps(): ServerDeps
  registerWorkers(): void
  close(): Promise<void>
}

function createDefaultLogger(): Logger {
  const p = pino({ level: process.env.LOG_LEVEL ?? 'info' })
  // Every caller passes a structured object as the first arg (see dispatch/
  // delivery services), which is exactly pino's merging-object signature.
  return {
    info: (o, m) => p.info(o as Record<string, unknown>, m),
    warn: (o, m) => p.warn(o as Record<string, unknown>, m),
    error: (o, m) => p.error(o as Record<string, unknown>, m)
  }
}

export function buildContainer(
  config: AppConfig,
  overrides: ContainerOverrides = {}
): Container {
  const logger = overrides.logger ?? createDefaultLogger()
  const clock: Clock = overrides.clock ?? { now: () => Date.now() }

  // Open the on-disk DB only when repositories aren't injected. Tests inject
  // in-memory repos and never touch SQLite; production opens the real file.
  let db: Database.Database | null = null
  if (!overrides.channelRepo || !overrides.profileRepo) {
    db = openDatabase(config.dbPath)
  }
  // `db!` is safe: it is opened above whenever the matching override is absent.
  const channelRepo: ChannelRepository =
    overrides.channelRepo ?? new SqliteChannelRepository(db!)
  const profileRepo: ProfileRepository =
    overrides.profileRepo ?? new SqliteProfileRepository(db!)

  // One-time migration: seed channels + profiles from the legacy .env-derived
  // config when the DB is empty. Idempotent (no-op once any channel exists).
  seedFromEnvIfEmpty(channelRepo, profileRepo, config)

  // Anonymous opt-in boot heartbeat (TEL-01/02/03). `db` is null only when
  // BOTH repos are injected (tests) -- there is no durable id source in that
  // case, so telemetry stays a Noop unless the caller also injects its own
  // `telemetryClient` override. Fire-and-forget: sendHeartbeat is never
  // awaited by boot, and any rejection is swallowed (spec Edge Cases) so a
  // PostHog outage -- or a scripted test failure -- can never delay or crash
  // api/worker startup.
  const telemetryClient: TelemetryPort =
    overrides.telemetryClient ??
    (db
      ? buildTelemetryClient({ env: process.env, distinctId: getOrCreateInstallId(db) })
      : new NoopTelemetryClient())
  const channelTypesEnabled = [...new Set(channelRepo.listEnabled().map((c) => c.type))]
  telemetryClient
    .sendHeartbeat({
      version: readPackageVersion(),
      channelTypesEnabled,
      platform: process.platform
    })
    .catch(() => {
      // Swallowed by design: telemetry must never block or crash boot.
    })

  // Per-delivery adapter deps. Real HTTP/mail transports are only constructed
  // when not overridden, so fakes never touch fetch/nodemailer. Note: the mail
  // transport is a single shared SMTP connection built from the seed's email
  // config -- per-instance SMTP credentials are a known limitation deferred to
  // the admin rewrite; webhook-style channels (the hot-reload cases) take
  // their URL straight from each instance's config.
  const channelDeps: ChannelDeps = {
    http: overrides.http ?? new FetchHttpClient(),
    mail: overrides.mail ?? new NodemailerTransport(config.channelConfig.email ?? {}),
    logger
  }

  const queue =
    overrides.queue ??
    new BullMqQueue({ redisUrl: config.redisUrl, retry: config.retry })

  const dispatchService = new DispatchService({ queue, channelRepo, profileRepo, logger })
  const deliveryService = new DeliveryService({ channelRepo, channelDeps, clock, logger })

  return {
    queue,
    buildServerDeps: () => ({ queue, profileRepo, channelRepo, logger }),
    registerWorkers: () => {
      queue.onDispatch((job) => dispatchService.handleDispatch(job))
      // Re-throw is preserved: deliver() throws on send failure so the queue
      // records a failed delivery / retries -- other instances' jobs are
      // independent, giving partial-failure isolation.
      queue.onDelivery(async (job) => {
        await deliveryService.deliver(job)
      })
    },
    close: async () => {
      await queue.close()
      db?.close()
    }
  }
}
