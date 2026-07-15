/**
 * Thin orchestration: runs `docker compose logs worker` via the injected
 * CommandRunner and parses it (ADMIN-06, ADMIN-05). Kept separate from
 * worker-log-parser.ts so that module stays a pure, I/O-free function.
 */
import type { CommandRunner } from './command-runner.js'
import { parseWorkerDeliveryLogs, type WorkerDeliveryEvent } from './worker-log-parser.js'

/** A command failure (non-zero exit, e.g. compose stack not running) yields no events rather than throwing -- the caller still returns a usable status/response. */
export async function fetchWorkerDeliveryEvents(
  commandRunner: CommandRunner,
  cwd?: string
): Promise<WorkerDeliveryEvent[]> {
  const result = await commandRunner.run('docker', ['compose', 'logs', 'worker', '--since', '10m', '--no-color'], {
    cwd
  })
  if (result.code !== 0) {
    return []
  }
  return parseWorkerDeliveryLogs(`${result.stdout}\n${result.stderr}`)
}
