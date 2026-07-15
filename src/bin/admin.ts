/**
 * Admin panel entrypoint (ADMIN-01, ADMIN-04..06). Builds the real
 * dependencies (fs-backed FileStore against the repo's `.env`, execFile
 * CommandRunner for `docker compose`, fetch-based HttpClient for the
 * gateway) and starts the Fastify server bound to 127.0.0.1 only. Resolves
 * paths relative to this file's own location (`import.meta.url`) so it
 * works identically run via `tsx` from `src/bin/admin.ts` and as the
 * compiled `dist/bin/admin.js` -- both have the same `<root>/bin/../admin`
 * layout, since `dist/admin/ui` is populated by the build's UI-copy step
 * (see package.json `build` script). All diagnostics go to stderr, never
 * stdout, and no secret value is ever logged (edge case: "no secret shall
 * be logged by the admin server").
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
  const envPath = join(repoRoot, '.env')
  const uiDir = resolveUiDir()

  if (!uiDir) {
    console.error('admin: warning -- could not locate the admin UI static files; API routes will still work')
  }

  const app = await startAdminServer({
    fileStore: new NodeEnvFileStore(envPath),
    registry: channelRegistry,
    commandRunner: new NodeCommandRunner(),
    http: new FetchHttpClient(),
    uiDir
  })

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
  console.error(`admin panel: http://127.0.0.1:${port}`)
}

main().catch((error) => {
  console.error('admin: failed to start', error)
  process.exit(1)
})
