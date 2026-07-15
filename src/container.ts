/**
 * Composition root (design Component 1): the single place concrete
 * implementations are instantiated and wired. Production builds real
 * channels/queue/transports from AppConfig; tests pass `overrides` to inject
 * fakes (InMemoryQueue, fake channels) and drive the whole pipeline without
 * network/Redis/SMTP. Exposes the queue, the server deps, worker
 * registration, and a close() for graceful shutdown.
 */
import pino from 'pino'
import type { ServerDeps } from './api/server.js'
import { createTokenResolver } from './auth/token-resolver.js'
import { ChannelBuilder } from './channels/channel-builder.js'
import { channelRegistry } from './channels/channel-registry.js'
import type { Clock, HttpClient, Logger, MailTransport, QueuePort } from './core/ports.js'
import type { AppConfig, NotificationChannel, Profile } from './core/types.js'
import { DeliveryService } from './delivery/delivery-service.js'
import { DispatchService } from './dispatch/dispatch-service.js'
import { FetchHttpClient } from './http/fetch-http-client.js'
import { BullMqQueue } from './queue/bullmq-queue.js'
import { NodemailerTransport } from './transports/nodemailer-transport.js'

export interface ContainerOverrides {
  queue?: QueuePort
  channels?: Map<string, NotificationChannel>
  http?: HttpClient
  mail?: MailTransport
  clock?: Clock
  logger?: Logger
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

  // Real HTTP/mail transports are only constructed when channels aren't
  // overridden, so tests that inject fake channels never touch nodemailer.
  const channels =
    overrides.channels ??
    ChannelBuilder.buildActive(channelRegistry, config.channelsEnabled, config.channelConfig, {
      http: overrides.http ?? new FetchHttpClient(),
      mail: overrides.mail ?? new NodemailerTransport(config.channelConfig.email ?? {}),
      logger
    })

  const queue =
    overrides.queue ??
    new BullMqQueue({ redisUrl: config.redisUrl, retry: config.retry })

  const activeChannelNames = [...channels.keys()]
  const tokenResolver = createTokenResolver(config.profiles)

  const profilesByName = new Map<string, Profile>(
    config.profiles.map((profile) => [profile.name, profile])
  )

  const dispatchService = new DispatchService({
    queue,
    logger,
    activeChannels: new Set(activeChannelNames),
    resolveProfile: (name) => {
      const profile = profilesByName.get(name)
      if (!profile) {
        throw new Error(`Unknown profile "${name}"`)
      }
      return profile
    }
  })

  const deliveryService = new DeliveryService({ channels, clock, logger })

  return {
    queue,
    buildServerDeps: () => ({ queue, tokenResolver, activeChannelNames, logger }),
    registerWorkers: () => {
      queue.onDispatch((job) => dispatchService.handleDispatch(job))
      // Re-throw is preserved: deliver() throws on channel failure so the
      // queue records a failed delivery / retries -- other channels' jobs
      // are independent, giving partial-failure isolation.
      queue.onDelivery(async (job) => {
        await deliveryService.deliver(job)
      })
    },
    close: async () => {
      await queue.close()
    }
  }
}
