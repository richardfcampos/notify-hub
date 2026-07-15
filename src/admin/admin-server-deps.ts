/**
 * Shared dependency shape for buildAdminServer (ADMIN-01..06). Kept in its
 * own module so every route file depends on one small interface instead of
 * importing admin-server.ts (which would create a cycle once routes are
 * registered from there).
 */
import type { HttpClient } from '../core/ports.js'
import type { ChannelSchema } from './admin-config.js'
import type { FileStore } from './env-file-store.js'

/**
 * Command-execution seam used by /api/apply, /api/status and
 * /api/test-send (the full `CommandRunner` port + execFile impl arrive in
 * ./command-runner.ts). Declared inline here so this module has no forward
 * dependency on that file.
 */
export interface CommandRunnerLike {
  run(
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number }
  ): Promise<{ code: number; stdout: string; stderr: string }>
}

export interface AdminServerDeps {
  fileStore: FileStore
  registry: Record<string, ChannelSchema>
  commandRunner?: CommandRunnerLike
  http?: HttpClient
  uiDir?: string
}
