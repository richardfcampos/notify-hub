/**
 * GET /channels (spec MCP-02). Bearer-authenticated: lets a caller discover
 * which channels are active in this deployment and which ones their token's
 * profile receives by default, without hand-rolling a POST /notify to find
 * out. Reuses the same auth preHandler as /notify -- missing/unknown token
 * -> 401, nothing else runs.
 */
import type { FastifyInstance } from 'fastify'
import { createAuthPreHandler } from '../plugins/auth.js'
import type { ServerDeps } from '../server.js'

export function registerChannelsRoute(app: FastifyInstance, deps: ServerDeps): void {
  const authPreHandler = createAuthPreHandler(deps.tokenResolver)

  app.get('/channels', { preHandler: authPreHandler }, async (request, reply) => {
    const profile = request.profile
    if (!profile) {
      // Unreachable: the auth preHandler either sets profile or already replied 401.
      return reply.code(401).send({ error: 'unauthorized' })
    }

    return reply.code(200).send({
      channels: deps.activeChannelNames,
      defaultChannels: profile.defaultChannels
    })
  })
}
