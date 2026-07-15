/**
 * Admin panel entrypoint (ADMIN-01, ADMIN-04..06, ADMIN-08). Builds the
 * real dependencies (fs-backed FileStore, execFile CommandRunner for
 * `docker compose`, fetch-based HttpClient for the gateway) and starts the
 * Fastify server. All diagnostics go to stderr, never stdout, and no
 * secret value is ever logged (edge case: "no secret shall be logged by
 * the admin server").
 *
 * Host mode (`npm run admin`) vs. compose mode (the dockerized `admin`
 * service) differ only through env vars -- this file stays a thin,
 * env-reading wrapper; every module it wires stays env-free itself:
 * - `ADMIN_HOST` (default `127.0.0.1`): compose sets `0.0.0.0` so the
 *   container accepts connections from the host's port mapping, which is
 *   itself pinned to 127.0.0.1 (ADMIN-01.2).
 * - `ENV_FILE_PATH` (default `<cwd>/.env`): compose sets `/config/.env`
 *   (the bind-mounted repo dir) so writes/backups land on the host.
 * - `COMPOSE_DIR` (default `<cwd>`): working directory for `docker compose`
 *   invocations (apply, worker-log tail); compose sets `/config`.
 * - `NOTIFY_GATEWAY_URL` (default: derived from `.env`'s PORT via
 *   gateway-client.ts, i.e. `http://localhost:<port>`): compose sets
 *   `http://api:<port>` so the containerized panel reaches the gateway
 *   over the compose network instead of localhost.
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
import { channelRegistry } from '../channels/channel-registry.js'
import { startAdminServer } from '../admin/admin-server.js'
import { NodeCommandRunner } from '../admin/command-runner.js'
import { NodeEnvFileStore } from '../admin/env-file-store.js'
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
  const envPath = process.env.ENV_FILE_PATH ?? join(process.cwd(), '.env')
  const composeDir = process.env.COMPOSE_DIR ?? process.cwd()
  const gatewayBaseUrl = process.env.NOTIFY_GATEWAY_URL
  const uiDir = resolveUiDir()

  if (!uiDir) {
    console.error('admin: warning -- could not locate the admin UI static files; API routes will still work')
  }

  const app = await startAdminServer(
    {
      fileStore: new NodeEnvFileStore(envPath),
      registry: channelRegistry,
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
