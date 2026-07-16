/**
 * GET /api/channel-types (DBCH-09, tasks.md D10 support route): exposes the
 * registry's type -> required-config-key map so the Add-channel UI doesn't
 * hardcode/duplicate the 7 channel types and their per-type fields --
 * staying in sync automatically if a new adapter is registered.
 */
import type { FastifyInstance } from 'fastify'
import { requiredConfigByChannel } from '../../channels/channel-registry.js'
import type { AdminServerDeps } from '../admin-server-deps.js'

export function registerChannelTypesRoute(app: FastifyInstance, _deps: AdminServerDeps): void {
  app.get('/api/channel-types', async (_request, reply) => {
    const types = Object.entries(requiredConfigByChannel).map(([type, requiredConfig]) => ({
      type,
      requiredConfig
    }))
    return reply.code(200).send({ types })
  })
}
