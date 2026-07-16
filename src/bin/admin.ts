/**
 * Admin panel entrypoint (ADMIN-01, ADMIN-04..06, ADMIN-08, rewired to
 * DBCH-08 by tasks.md D9). Opens the SAME SQLite file the gateway/worker use
 * (`DB_PATH`, WAL journaling lets multiple processes read/write safely) and
 * builds real repositories over it -- no `.env` FileStore, no
 * `docker compose apply` step: a save is live for the very next
 * request/delivery (AD-018, hot-reload). All diagnostics go to stderr, never
 * stdout, and no secret value is ever logged (edge case: "no secret shall be
 * logged by the admin server").
 *
 * Host mode (`npm run admin`) vs. compose mode (the dockerized `admin`
 * service) differ only through env vars -- this file stays a thin,
 * env-reading wrapper; every module it wires stays env-free itself:
 * - `ADMIN_HOST` (default `127.0.0.1`): compose sets `0.0.0.0` so the
 *   container accepts connections from the host's port mapping, which is
 *   itself pinned to 127.0.0.1 (ADMIN-01.2).
 * - `DB_PATH` (default `./data/notify-hub.db`, matching config/load-config.ts):
 *   the on-disk SQLite file shared with the api/worker processes.
 * - `COMPOSE_DIR` (default `<cwd>`): working directory for the worker-log
 *   tail `docker compose` invocation (status/test-send); compose sets
 *   `/config`.
 * - `NOTIFY_GATEWAY_URL` (default: `http://localhost:8080`): compose sets
 *   `http://api:<port>` so the containerized panel reaches the gateway over
 *   the compose network instead of localhost.
 *
 * Resolving the UI static dir is the one thing still anchored to this
 * file's own location (`import.meta.url`), since `dist/admin/ui` is
 * populated relative to the compiled script, not the cwd (see package.json
 * `build` script) -- it works identically via `tsx` from `src/bin/admin.ts`
 * and as the compiled `dist/bin/admin.js`.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startAdminServer } from '../admin/admin-server.js'
import { NodeCommandRunner } from '../admin/command-runner.js'
import { openDatabase } from '../db/database.js'
import { SqliteChannelRepository } from '../db/sqlite-channel-repository.js'
import { SqliteProfileRepository } from '../db/sqlite-profile-repository.js'
import { FetchHttpClient } from '../http/fetch-http-client.js'

const here = dirname(fileURLToPath(import.meta.url))
/** Two levels up from `bin/` (src/bin -> src -> repo root, or dist/bin -> dist -> repo root). */
const repoRoot = resolve(here, '../..')

/** Resolves the UI static directory: the layout-relative path first (works for both tsx-from-src and compiled dist), falling back to explicit repo-root-relative candidates for unusual invocations. */
function resolveUiDir(): string | undefined {
  const candidates = [resolve(here, '../admin/ui'), join(repoRoot, 'dist/admin/ui'), join(repoRoot, 'src/admin/ui')]
  return candidates.find((dir) => existsSync(join(dir, 'admin.html')))
}

async function main(): Promise<void> {
  const host = process.env.ADMIN_HOST ?? '127.0.0.1'
  const dbPath = process.env.DB_PATH ?? './data/notify-hub.db'
  const composeDir = process.env.COMPOSE_DIR ?? process.cwd()
  const gatewayBaseUrl = process.env.NOTIFY_GATEWAY_URL
  const uiDir = resolveUiDir()

  if (!uiDir) {
    console.error('admin: warning -- could not locate the admin UI static files; API routes will still work')
  }

  // Same on-disk file the gateway/worker open; WAL journaling (set by
  // openDatabase) is what makes concurrent multi-process access safe.
  const db = openDatabase(dbPath)
  const channelRepo = new SqliteChannelRepository(db)
  const profileRepo = new SqliteProfileRepository(db)

  const app = await startAdminServer(
    {
      channelRepo,
      profileRepo,
      commandRunner: new NodeCommandRunner(),
      http: new FetchHttpClient(),
      uiDir,
      composeDir,
      gatewayBaseUrl
    },
    { host }
  )

  const shutdown = async (signal: string): Promise<void> => {
    try {
      console.error(`admin: received ${signal}, shutting down`)
      await app.close()
      db.close()
      process.exit(0)
    } catch (error) {
      console.error('admin: error during shutdown', error)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  const address = app.server.address()
  const port = typeof address === 'object' && address !== null ? address.port : (process.env.ADMIN_PORT ?? 8081)
  // The reachable URL is always the loopback address: in host mode this
  // process bound it directly, in compose mode the host-side port mapping
  // is pinned to 127.0.0.1 regardless of the container's internal host.
  console.error(`admin panel: http://127.0.0.1:${port}`)
}

main().catch((error) => {
  console.error('admin: failed to start', error)
  process.exit(1)
})
