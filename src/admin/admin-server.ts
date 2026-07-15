/**
 * Admin panel Fastify app factory (ADMIN-01). All external seams
 * (FileStore, channel registry, CommandRunner, HttpClient, static UI dir)
 * are injected via AdminServerDeps so tests drive the whole API with
 * `app.inject` over fakes -- no real file, no Docker, no network.
 *
 * `startAdminServer` is the only place a host/port is chosen: the host is
 * HARDCODED to 127.0.0.1 (never env-overridable, never 0.0.0.0) per the
 * spec's security assumption -- the admin panel's trust boundary is "runs
 * on this machine only".
 */
import Fastify, { type FastifyInstance } from 'fastify'
import { registerApplyRoute } from './routes/apply-route.js'
import { registerConfigRoutes } from './routes/config-routes.js'
import { registerStatusRoute } from './routes/status-route.js'
import { registerTestSendRoute } from './routes/test-send-route.js'
import { registerStaticUiRoutes } from './static-ui-files.js'
import type { AdminServerDeps } from './admin-server-deps.js'

export type { AdminServerDeps } from './admin-server-deps.js'

export function buildAdminServer(deps: AdminServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  registerConfigRoutes(app, deps)
  registerApplyRoute(app, deps)
  registerStatusRoute(app, deps)
  registerTestSendRoute(app, deps)

  // Registered last: Fastify's router (find-my-way) matches static paths
  // like /api/config ahead of a /* wildcard regardless of registration
  // order, so this can never shadow the API routes above.
  if (deps.uiDir) {
    registerStaticUiRoutes(app, deps.uiDir)
  }

  return app
}

const DEFAULT_ADMIN_PORT = 8081
/** Never env-overridable, never 0.0.0.0 (ADMIN-01 security AC). */
const ADMIN_HOST = '127.0.0.1'

/** Builds and starts listening. `port` defaults to `ADMIN_PORT` env var, falling back to 8081. */
export async function startAdminServer(
  deps: AdminServerDeps,
  opts: { port?: number } = {}
): Promise<FastifyInstance> {
  const app = buildAdminServer(deps)
  const port = opts.port ?? Number(process.env.ADMIN_PORT ?? DEFAULT_ADMIN_PORT)
  await app.listen({ host: ADMIN_HOST, port })
  return app
}
