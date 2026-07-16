/**
 * Bearer-token auth for protected routes (spec NOTIF-01.2, DBCH-07).
 * A Fastify preHandler reads `Authorization: Bearer <token>`, resolves it
 * to a profile via the injected ProfileRepository (read from the DB so
 * profile edits take effect with no restart), and either short-circuits
 * with 401 (missing/unknown token -> nothing downstream runs, so nothing is
 * enqueued) or attaches the resolved profile record to the request for the
 * route handler to use.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { ProfileRepository } from '../../core/ports.js'
import type { ProfileRecord } from '../../core/types.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth preHandler once a Bearer token resolves to a profile. */
    profile?: ProfileRecord
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
  profileRepo: ProfileRepository
): preHandlerHookHandler {
  return async function authPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization)
    const profile = profileRepo.resolveByToken(token)
    if (!profile) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    request.profile = profile
  }
}
