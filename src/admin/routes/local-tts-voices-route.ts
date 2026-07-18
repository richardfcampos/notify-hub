/**
 * GET /api/local-tts/voices?url=<player base url> (spec LTTS-03): proxies to
 * the local-tts player's own `GET /voices` server-side so the browser never
 * has to cross-origin-fetch an arbitrary `http://<host>:<port>` URL typed
 * into a config field (avoids CORS/mixed-content entirely, same rationale as
 * every other gateway call going through the admin backend). The player
 * (`clients/local-tts-player/local-tts-server.mjs`) responds with a BARE
 * `[{name, locale, sample}]` array, which this route wraps under a `voices`
 * key so the admin UI has one consistent response shape. NEVER bubbles a
 * 500: any failure (missing HttpClient, network error, non-2xx, unparseable
 * body) degrades to `200 {voices: [], reachable: false}` so the UI's
 * fallback-to-text-input path always has a clean, predictable signal to act
 * on instead of having to distinguish error types.
 */
import type { FastifyInstance } from 'fastify'
import type { AdminServerDeps } from '../admin-server-deps.js'

interface LocalTtsVoice {
  name: string
  locale: string
  sample: string
}

function isLocalTtsVoice(value: unknown): value is LocalTtsVoice {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).name === 'string' &&
    typeof (value as Record<string, unknown>).locale === 'string' &&
    typeof (value as Record<string, unknown>).sample === 'string'
  )
}

/** Shared shape for every failure path (missing HttpClient, network error, non-2xx, bad JSON). */
const UNREACHABLE = { voices: [] as LocalTtsVoice[], reachable: false as const }

export function registerLocalTtsVoicesRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.get('/api/local-tts/voices', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const url = typeof query.url === 'string' ? query.url.trim() : ''
    if (!url) {
      return reply.code(400).send({ error: 'url query parameter is required' })
    }

    if (!deps.http) {
      return reply.code(200).send(UNREACHABLE)
    }

    try {
      const res = await deps.http.request({ method: 'GET', url: `${url}/voices` })
      if (res.status < 200 || res.status >= 300) {
        return reply.code(200).send(UNREACHABLE)
      }
      const parsed: unknown = JSON.parse(res.body)
      const voices = Array.isArray(parsed) ? parsed.filter(isLocalTtsVoice) : []
      return reply.code(200).send({ voices, reachable: true })
    } catch {
      return reply.code(200).send(UNREACHABLE)
    }
  })
}
