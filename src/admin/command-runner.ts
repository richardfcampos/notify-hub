/**
 * CommandRunner port (ADMIN-04, scope narrowed to worker-log tailing by
 * DBCH-08): the seam /api/status and /api/test-send use to shell out to
 * `docker compose logs worker` without any route handler importing
 * child_process directly (config CRUD is DB-backed and never shells out --
 * DBCH-08's hot-reload dropped the old `/api/apply` compose-restart path).
 * `NodeCommandRunner` always uses `execFile` (args passed as an array, never
 * a shell-interpolated string) so arguments can never be reinterpreted by a
 * shell. Tests use `FakeCommandRunner` (test/helpers/fakes.ts) to script
 * results instantly.
 */
import { execFile, type ExecFileException } from 'node:child_process'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface CommandRunner {
  run(cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<CommandResult>
}

function exitCodeOf(error: ExecFileException | null): number {
  if (!error) {
    return 0
  }
  return typeof error.code === 'number' ? error.code : 1
}

export class NodeCommandRunner implements CommandRunner {
  run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<CommandResult> {
    return new Promise((resolve) => {
      execFile(
        cmd,
        args,
        { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve({ code: exitCodeOf(error), stdout: stdout.toString(), stderr: stderr.toString() })
        }
      )
    })
  }
}
