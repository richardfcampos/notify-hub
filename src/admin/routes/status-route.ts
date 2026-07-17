/**
 * GET /api/status (ADMIN-06, rewired to DBCH-07's new `/channels` shape by
 * tasks.md D9). Thin HTTP mapping over the shared `getStatusSummary`
 * (../status-service.ts, also used by the MCP `get_status` tool) so the
 * panel and MCP clients see identical data.
 */
import type { FastifyInstance } from 'fastify'
import type { AdminServerDeps } from '../admin-server-deps.js'
import { getStatusSummary } from '../status-service.js'

export function registerStatusRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.get('/api/status', async (_request, reply) => {
    const summary = await getStatusSummary(deps)
    return reply.code(200).send(summary)
  })
}
