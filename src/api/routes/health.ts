/**
 * GET /health (spec NOTIF-14). Unauthenticated liveness + Redis-connectivity
 * probe: always 200 with an `ok` status and a boolean `redis` indicator from
 * the queue's health() (true when the backing store is reachable).
 */
import type { FastifyInstance } from 'fastify'
import type { ServerDeps } from '../server.js'

export function registerHealthRoute(app: FastifyInstance, deps: ServerDeps): void {
  app.get('/health', async (_request, reply) => {
    const redis = await deps.queue.health()
    return reply.code(200).send({ status: 'ok', redis })
  })
}
