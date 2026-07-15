/**
 * Shared dependency shape for buildAdminServer (ADMIN-01..06, ADMIN-08).
 * Kept in its own module so every route file depends on one small
 * interface instead of importing admin-server.ts (which would create a
 * cycle once routes are registered from there).
 */
import type { HttpClient } from '../core/ports.js'
import type { ChannelSchema } from './admin-config.js'
import type { CommandRunner } from './command-runner.js'
import type { FileStore } from './env-file-store.js'

export interface AdminServerDeps {
  fileStore: FileStore
  registry: Record<string, ChannelSchema>
  /** Required for /api/apply, /api/status (delivery tail) and /api/test-send's outcome poll. */
  commandRunner?: CommandRunner
  /** Required for /api/status (gateway health/channels) and /api/test-send. */
  http?: HttpClient
  uiDir?: string
  /**
   * Working directory for `docker compose` invocations (apply, worker-log
   * tail). Explicit dependency instead of a bare `process.cwd()` read
   * inside each route -- `src/bin/admin.ts` wires it from `COMPOSE_DIR`
   * (ADMIN-08.3). Falls back to `process.cwd()` at the call site when
   * omitted (e.g. in tests that don't care about cwd).
   */
  composeDir?: string
  /**
   * Overrides the gateway base URL normally derived from the config's
   * `extraKeys.PORT` (`http://localhost:<port>`). `src/bin/admin.ts` wires
   * it from `NOTIFY_GATEWAY_URL` so the containerized admin service can
   * reach the gateway at `http://api:<port>` (ADMIN-08.4).
   */
  gatewayBaseUrl?: string
  /** Test-send outcome poll tuning (ADMIN-05.2/.3). Defaults: 10 attempts x 1000ms (~10s total real). */
  testSendPollAttempts?: number
  testSendPollIntervalMs?: number
  /** Injectable delay between poll attempts so tests run instantly instead of waiting real time. */
  delay?: (ms: number) => Promise<void>
}
