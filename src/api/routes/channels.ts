/**
 * GET /channels (spec DBCH-07). Bearer-authenticated: lets a caller discover
 * the named channel INSTANCES configured in this deployment (id, label,
 * type, enabled) and which instance ids their token's profile routes to by
 * default. Read live from the DB so panel edits reflect immediately. Reuses
 * the same auth preHandler as /notify -- missing/unknown token -> 401.
 */
import type { FastifyInstance } from 'fastify'
import { createAuthPreHandler } from '../plugins/auth.js'
import type { ServerDeps } from '../server.js'

export function registerChannelsRoute(app: FastifyInstance, deps: ServerDeps): void {
  const authPreHandler = createAuthPreHandler(deps.profileRepo)

  app.get('/channels', { preHandler: authPreHandler }, async (request, reply) => {
    const profile = request.profile
    if (!profile) {
      // Unreachable: the auth preHandler either sets profile or already replied 401.
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const channels = deps.channelRepo.list().map((c) => ({
      id: c.id,
      label: c.label,
      type: c.type,
      enabled: c.enabled
    }))

    return reply.code(200).send({
      channels,
      defaultChannels: profile.defaultChannels
    })
  })
}
