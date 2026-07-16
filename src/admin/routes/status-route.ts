/**
 * GET /api/status (ADMIN-06, rewired to DBCH-07's new `/channels` shape by
 * tasks.md D9): gateway health + named channel instances (via the injected
 * HttpClient, first profile's token from ProfileRepository) run in parallel
 * with the worker's recent delivery log tail (via CommandRunner). Gateway
 * unreachable -> `gateway.up:false`, everything else still returned
 * (AC ADMIN-06.2) -- this route never throws on a downstream failure.
 */
import type { FastifyInstance } from 'fastify'
import type { AdminServerDeps } from '../admin-server-deps.js'
import { buildGatewayContext, fetchGatewayStatus } from '../gateway-client.js'
import { fetchWorkerDeliveryEvents } from '../worker-logs.js'

export function registerStatusRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.get('/api/status', async (_request, reply) => {
    const token = deps.profileRepo.list()[0]?.token
    const gatewayContext = buildGatewayContext(token, deps.gatewayBaseUrl)

    const gateway = deps.http
      ? await fetchGatewayStatus(deps.http, gatewayContext)
      : { up: false, channels: [], defaultChannels: [] }

    const recentDeliveries = deps.commandRunner
      ? await fetchWorkerDeliveryEvents(deps.commandRunner, deps.composeDir ?? process.cwd())
      : []

    return reply.code(200).send({
      gateway: gateway.up ? { up: true, redis: gateway.redis } : { up: false },
      channels: gateway.channels,
      defaultChannels: gateway.defaultChannels,
      recentDeliveries
    })
  })
}
