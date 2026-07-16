/**
 * Shared dependency shape for buildAdminServer (DBCH-08, tasks.md D9).
 * Config CRUD is DB-backed directly through the repositories -- no
 * FileStore, no channel-schema registry injection, no CommandRunner-driven
 * `docker compose apply` step (hot-reload means a save takes effect
 * immediately, spec AD-018). CommandRunner survives ONLY as the seam for
 * tailing worker delivery logs (status + test-send outcome polling).
 *
 * Kept in its own module so every route file depends on one small
 * interface instead of importing admin-server.ts (which would create a
 * cycle once routes are registered from there).
 */
import type { ChannelRepository, HttpClient, ProfileRepository } from '../core/ports.js'
import type { CommandRunner } from './command-runner.js'

export interface AdminServerDeps {
  /** Named channel instances, read/written live -- panel edits hot-reload with no restart. */
  channelRepo: ChannelRepository
  /** Token profiles + their default channel ids. */
  profileRepo: ProfileRepository
  /** Required for /api/status (gateway health/channels) and /api/test-send. */
  http?: HttpClient
  /** Worker-log tailing ONLY (recent-deliveries tail + test-send outcome poll) -- config CRUD never shells out. */
  commandRunner?: CommandRunner
  uiDir?: string
  /**
   * Working directory for the worker-log-tail `docker compose` invocation.
   * `src/bin/admin.ts` wires it from `COMPOSE_DIR`. Falls back to
   * `process.cwd()` at the call site when omitted (tests that don't care).
   */
  composeDir?: string
  /**
   * Overrides the gateway base URL (default `http://localhost:8080`).
   * `src/bin/admin.ts` wires it from `NOTIFY_GATEWAY_URL` so the
   * containerized admin service can reach the gateway at `http://api:<port>`.
   */
  gatewayBaseUrl?: string
  /** Test-send outcome poll tuning. Defaults: 10 attempts x 1000ms (~10s total real). */
  testSendPollAttempts?: number
  testSendPollIntervalMs?: number
  /** Injectable delay between poll attempts so tests run instantly instead of waiting real time. */
  delay?: (ms: number) => Promise<void>
}
