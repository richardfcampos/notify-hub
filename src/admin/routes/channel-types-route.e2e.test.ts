/**
 * e2e via `app.inject`: the response is derived straight from the real
 * channel registry (spec: "the 7 registry types"), not a fake, since this
 * route exists precisely so the UI never hardcodes/duplicates that list.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { requiredConfigByChannel } from '../../channels/channel-registry.js'
import { FakeChannelRepository, FakeProfileRepository } from '../../../test/helpers/fakes.js'
import { buildAdminServer } from '../admin-server.js'

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

describe('GET /api/channel-types', () => {
  it('returns every registry type with its required config keys', async () => {
    const app = buildAdminServer({ channelRepo: new FakeChannelRepository(), profileRepo: new FakeProfileRepository() })
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/channel-types' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      types: Object.entries(requiredConfigByChannel).map(([type, requiredConfig]) => ({ type, requiredConfig }))
    })
  })

  it('includes ntfy with its two required keys (spot check against the real registry)', async () => {
    const app = buildAdminServer({ channelRepo: new FakeChannelRepository(), profileRepo: new FakeProfileRepository() })
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/channel-types' })

    const ntfy = res.json().types.find((t: { type: string }) => t.type === 'ntfy')
    expect(ntfy.requiredConfig).toEqual(requiredConfigByChannel.ntfy)
  })
})
