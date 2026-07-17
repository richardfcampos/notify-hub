/**
 * Admin panel Fastify app factory (ADMIN-01, revised by DBCH-08/09: DB-backed
 * config, no apply step). All external seams (channel/profile repositories,
 * CommandRunner, HttpClient, static UI dir) are injected via AdminServerDeps
 * so tests drive the whole API with `app.inject` over fakes -- no real
 * SQLite file, no Docker, no network.
 *
 * `startAdminServer` is the only place a host/port is chosen. The host
 * defaults to 127.0.0.1 (loopback-only, matching the security assumption
 * for host-mode `npm run admin`) but accepts an explicit `host` option so
 * `src/bin/admin.ts` can pass `ADMIN_HOST=0.0.0.0` when running inside the
 * compose `admin` container. When containerized, the LAN-unreachable
 * invariant moves to the compose port mapping (`127.0.0.1:8081:8081`)
 * instead of this process (ADMIN-01.2 revised, asserted by
 * src/admin/compose-invariants.test.ts).
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { registerChannelTypesRoute } from './routes/channel-types-route.js'
import { registerConfigRoutes } from './routes/config-routes.js'
import { registerMcpRoute } from './routes/mcp-route.js'
import { registerStatusRoute } from './routes/status-route.js'
import { registerTestSendRoute } from './routes/test-send-route.js'
import { registerStaticUiRoutes } from './static-ui-files.js'
import type { AdminServerDeps } from './admin-server-deps.js'

export type { AdminServerDeps } from './admin-server-deps.js'

export function buildAdminServer(deps: AdminServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  registerConfigRoutes(app, deps)
  registerChannelTypesRoute(app, deps)
  registerStatusRoute(app, deps)
  registerTestSendRoute(app, deps)
  registerMcpRoute(app, deps)

  // Registered last: Fastify's router (find-my-way) matches static paths
  // like /api/config ahead of a /* wildcard regardless of registration
  // order, so this can never shadow the API routes above.
  if (deps.uiDir) {
    registerStaticUiRoutes(app, deps.uiDir)
  }

  return app
}

const DEFAULT_ADMIN_PORT = 8081
/** Default host when `opts.host` is omitted: loopback-only (ADMIN-01 security AC for host mode). */
const DEFAULT_ADMIN_HOST = '127.0.0.1'

/**
 * Builds and starts listening. `port` defaults to `ADMIN_PORT` env var,
 * falling back to 8081. `host` defaults to 127.0.0.1 -- callers (e.g.
 * `src/bin/admin.ts` reading `ADMIN_HOST`) opt into 0.0.0.0 explicitly for
 * container mode; this function never picks 0.0.0.0 on its own.
 */
export async function startAdminServer(
  deps: AdminServerDeps,
  opts: { port?: number; host?: string } = {}
): Promise<FastifyInstance> {
  const app = buildAdminServer(deps)
  const port = opts.port ?? Number(process.env.ADMIN_PORT ?? DEFAULT_ADMIN_PORT)
  const host = opts.host ?? DEFAULT_ADMIN_HOST
  await app.listen({ host, port })
  return app
}
