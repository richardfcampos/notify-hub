/**
 * Fastify app factory (spec NOTIF-01, NOTIF-14). All external seams are
 * injected via `ServerDeps` so tests build a real app over InMemoryQueue +
 * a fake TokenResolver and drive it with `app.inject` -- no listener, no
 * Redis. The composition root supplies the production deps.
 */
import Fastify, { type FastifyInstance } from 'fastify'
import type { Logger, QueuePort, TokenResolver } from '../core/ports.js'
import { registerChannelsRoute } from './routes/channels.js'
import { registerHealthRoute } from './routes/health.js'
import { registerNotifyRoute } from './routes/notify.js'

export interface ServerDeps {
  queue: QueuePort
  tokenResolver: TokenResolver
  /** Names of channels active in this deployment; used to reject unknown `channels`. */
  activeChannelNames: string[]
  logger: Logger
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  // Registered so per-request assignment in the auth preHandler is a known field.
  app.decorateRequest('profile', undefined)

  registerHealthRoute(app, deps)
  registerNotifyRoute(app, deps)
  registerChannelsRoute(app, deps)

  return app
}
