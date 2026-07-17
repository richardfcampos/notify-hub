/**
 * Shared status snapshot (spec ADMIN-06, MCPC-04): gateway health + named
 * channel instances (via the injected HttpClient, first profile's token)
 * combined with the worker's recent delivery log tail (via CommandRunner).
 * Used by both `GET /api/status` (routes/status-route.ts) and the MCP
 * `get_status` tool (register-config-tools.ts) so the two surfaces report
 * identical data. Gateway unreachable -> `gateway.up:false`, everything else
 * still returned (AC ADMIN-06.2) -- this never throws on a downstream
 * failure.
 */
import type { HttpClient, ProfileRepository } from '../core/ports.js'
import type { CommandRunner } from './command-runner.js'
import { buildGatewayContext, fetchGatewayStatus, type GatewayChannelSummary } from './gateway-client.js'
import { fetchWorkerDeliveryEvents } from './worker-logs.js'
import type { WorkerDeliveryEvent } from './worker-log-parser.js'

export interface StatusServiceDeps {
  profileRepo: ProfileRepository
  http?: HttpClient
  commandRunner?: CommandRunner
  composeDir?: string
  gatewayBaseUrl?: string
}

export interface StatusSummary {
  gateway: { up: true; redis?: boolean } | { up: false }
  channels: GatewayChannelSummary[]
  defaultChannels: string[]
  recentDeliveries: WorkerDeliveryEvent[]
}

export async function getStatusSummary(deps: StatusServiceDeps): Promise<StatusSummary> {
  const token = deps.profileRepo.list()[0]?.token
  const gatewayContext = buildGatewayContext(token, deps.gatewayBaseUrl)

  const gateway = deps.http
    ? await fetchGatewayStatus(deps.http, gatewayContext)
    : { up: false, channels: [], defaultChannels: [] }

  const recentDeliveries = deps.commandRunner
    ? await fetchWorkerDeliveryEvents(deps.commandRunner, deps.composeDir ?? process.cwd())
    : []

  return {
    gateway: gateway.up ? { up: true, redis: gateway.redis } : { up: false },
    channels: gateway.channels,
    defaultChannels: gateway.defaultChannels,
    recentDeliveries
  }
}
