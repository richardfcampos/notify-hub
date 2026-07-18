/**
 * e2e via `app.inject` + FakeHttpClient (spec LTTS-03): happy path proxies
 * the player's bare voices array wrapped under `{voices, reachable:true}`;
 * every failure mode (unreachable, non-2xx, malformed JSON, no HttpClient
 * wired) degrades to `200 {voices: [], reachable: false}` -- never a 500 --
 * so the admin UI always gets a clean signal to fall back to a text input;
 * a missing `url` query param 400s naming it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeChannelRepository, FakeHttpClient, FakeProfileRepository } from '../../../test/helpers/fakes.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

function makeApp(overrides: Partial<AdminServerDeps> = {}): { app: FastifyInstance; http: FakeHttpClient } {
  const http = (overrides.http as FakeHttpClient) ?? new FakeHttpClient()
  const deps: AdminServerDeps = {
    channelRepo: new FakeChannelRepository(),
    profileRepo: new FakeProfileRepository(),
    http,
    ...overrides
  }
  return { app: buildAdminServer(deps), http }
}

describe('GET /api/local-tts/voices', () => {
  it('proxies the player and wraps its bare array under voices (happy path)', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueResponse({
      status: 200,
      body: JSON.stringify([
        { name: 'Luciana', locale: 'pt_BR', sample: 'Ola, como vai?' },
        { name: 'Grandma (Portuguese (Brazil))', locale: 'pt_BR', sample: 'Ola' }
      ])
    })

    const res = await app.inject({ method: 'GET', url: '/api/local-tts/voices?url=http%3A%2F%2F127.0.0.1%3A8082' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      voices: [
        { name: 'Luciana', locale: 'pt_BR', sample: 'Ola, como vai?' },
        { name: 'Grandma (Portuguese (Brazil))', locale: 'pt_BR', sample: 'Ola' }
      ],
      reachable: true
    })
    expect(http.calls[0]).toEqual({ method: 'GET', url: 'http://127.0.0.1:8082/voices' })
  })

  it('degrades to {voices: [], reachable: false} (still 200) when the player is unreachable', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueError(new Error('ECONNREFUSED'))

    const res = await app.inject({ method: 'GET', url: '/api/local-tts/voices?url=http%3A%2F%2F127.0.0.1%3A8082' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: [], reachable: false })
  })

  it('degrades to {voices: [], reachable: false} on a non-2xx player response', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueResponse({ status: 500, body: 'internal error' })

    const res = await app.inject({ method: 'GET', url: '/api/local-tts/voices?url=http%3A%2F%2F127.0.0.1%3A8082' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: [], reachable: false })
  })

  it('degrades to {voices: [], reachable: false} on a malformed JSON body', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueResponse({ status: 200, body: 'not json' })

    const res = await app.inject({ method: 'GET', url: '/api/local-tts/voices?url=http%3A%2F%2F127.0.0.1%3A8082' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: [], reachable: false })
  })

  it('degrades to {voices: [], reachable: false} when no HttpClient is wired (misconfigured server)', async () => {
    const { app } = makeApp({ http: undefined })
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/local-tts/voices?url=http%3A%2F%2F127.0.0.1%3A8082' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ voices: [], reachable: false })
  })

  it('rejects a missing url query param with 400 naming it', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/local-tts/voices' })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('url query parameter is required')
  })
})
