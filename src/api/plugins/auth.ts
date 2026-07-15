/**
 * Bearer-token auth for protected routes (spec NOTIF-01.2, NOTIF-11).
 * A Fastify preHandler reads `Authorization: Bearer <token>`, resolves it
 * via the injected TokenResolver, and either short-circuits with 401
 * (missing/unknown token -> nothing downstream runs, so nothing is
 * enqueued) or attaches the resolved profile to the request for the route
 * handler to use.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { TokenResolver } from '../../core/ports.js'
import type { Profile } from '../../core/types.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth preHandler once a Bearer token resolves to a profile. */
    profile?: Profile
  }
}

const BEARER_PREFIX = /^Bearer\s+(.+)$/i

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined
  }
  const match = BEARER_PREFIX.exec(header)
  return match ? match[1].trim() : undefined
}

export function createAuthPreHandler(
  tokenResolver: TokenResolver
): preHandlerHookHandler {
  return async function authPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization)
    const profile = tokenResolver.resolve(token)
    if (!profile) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    request.profile = profile
  }
}
