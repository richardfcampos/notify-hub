/**
 * GET /api/status (ADMIN-06): gateway health + active channels (via the
 * injected HttpClient, first profile's token) run in parallel with the
 * worker's recent delivery log tail (via CommandRunner). Gateway
 * unreachable -> `gateway.up:false`, everything else still returned
 * (AC ADMIN-06.2) -- this route never throws on a downstream failure.
 */
import type { FastifyInstance } from 'fastify'
import { parseAdminConfig } from '../admin-config.js'
import type { AdminServerDeps } from '../admin-server-deps.js'
import { buildGatewayContext, fetchGatewayStatus } from '../gateway-client.js'
import { fetchWorkerDeliveryEvents } from '../worker-logs.js'

export function registerStatusRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.get('/api/status', async (_request, reply) => {
    const raw = await deps.fileStore.read()
    const cfg = parseAdminConfig(raw, deps.registry)

    const gateway = deps.http
      ? await fetchGatewayStatus(deps.http, buildGatewayContext(cfg))
      : { up: false, channels: [], defaultChannels: [] }

    const recentDeliveries = deps.commandRunner
      ? await fetchWorkerDeliveryEvents(deps.commandRunner, process.cwd())
      : []

    return reply.code(200).send({
      gateway: gateway.up ? { up: true, redis: gateway.redis } : { up: false },
      channels: gateway.channels,
      defaultChannels: gateway.defaultChannels,
      recentDeliveries
    })
  })
}
