/**
 * e2e via Fastify `app.inject` (no listener) over FakeChannelRepository +
 * FakeProfileRepository (spec DBCH-08, tasks.md D9). Derived from spec ACs:
 * GET reflects the seeded repos; PUT applies the upsert+delete diff on a
 * valid payload; each write-time validation rule 400s naming the offender
 * and leaves the repos untouched (nothing partially applied).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeChannelRepository, FakeProfileRepository } from '../../../test/helpers/fakes.js'
import type { ChannelInstance, ProfileRecord } from '../../core/types.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'

function channel(over: Partial<ChannelInstance> & { id: string }): ChannelInstance {
  return { label: over.id, type: 'ntfy', enabled: true, config: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' }, ...over }
}

function profile(over: Partial<ProfileRecord> & { id: string; token: string }): ProfileRecord {
  return { name: over.id, defaultChannels: [], ...over }
}

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

function makeApp(overrides: Partial<AdminServerDeps> = {}): {
  app: FastifyInstance
  channelRepo: FakeChannelRepository
  profileRepo: FakeProfileRepository
} {
  const channelRepo = (overrides.channelRepo as FakeChannelRepository) ?? new FakeChannelRepository()
  const profileRepo = (overrides.profileRepo as FakeProfileRepository) ?? new FakeProfileRepository()
  const deps: AdminServerDeps = { channelRepo, profileRepo, ...overrides }
  return { app: buildAdminServer(deps), channelRepo, profileRepo }
}

describe('GET /api/config', () => {
  it('reflects the seeded channels and profiles', async () => {
    const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy' })])
    const profileRepo = new FakeProfileRepository([
      profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })
    ])
    const { app } = makeApp({ channelRepo, profileRepo })
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/config' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      channels: [channel({ id: 'acme-ntfy' })],
      profiles: [profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })]
    })
  })

  it('returns empty arrays when the repos are empty', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/config' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ channels: [], profiles: [] })
  })
})

describe('PUT /api/config', () => {
  it('upserts new channels and profiles on a valid payload', async () => {
    const { app, channelRepo, profileRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        channels: [channel({ id: 'acme-ntfy' })],
        profiles: [profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })]
      }
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(channelRepo.list()).toEqual([channel({ id: 'acme-ntfy' })])
    expect(profileRepo.list()).toEqual([profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })])
  })

  it('deletes a channel absent from the payload (diff apply)', async () => {
    const channelRepo = new FakeChannelRepository([channel({ id: 'keep' }), channel({ id: 'drop' })])
    const { app } = makeApp({ channelRepo })
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [channel({ id: 'keep' })], profiles: [] }
    })

    expect(res.statusCode).toBe(200)
    expect(channelRepo.list().map((c) => c.id)).toEqual(['keep'])
  })

  it('deletes a profile absent from the payload (diff apply)', async () => {
    const profileRepo = new FakeProfileRepository([
      profile({ id: 'keep', token: 'tok-keep' }),
      profile({ id: 'drop', token: 'tok-drop' })
    ])
    const { app } = makeApp({ profileRepo })
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [], profiles: [profile({ id: 'keep', token: 'tok-keep' })] }
    })

    expect(res.statusCode).toBe(200)
    expect(profileRepo.list().map((p) => p.id)).toEqual(['keep'])
  })

  it('rejects a malformed body (400) and writes nothing', async () => {
    const { app, channelRepo } = makeApp()
    current = app

    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { nonsense: true } })

    expect(res.statusCode).toBe(400)
    expect(channelRepo.list()).toEqual([])
  })

  it('rejects an invalid slug id, naming it, and writes nothing', async () => {
    const { app, channelRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [channel({ id: 'Not A Slug' })], profiles: [] }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('"Not A Slug"')
    expect(channelRepo.list()).toEqual([])
  })

  it('rejects duplicate channel ids in the payload, naming it, and writes nothing', async () => {
    const { app, channelRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [channel({ id: 'dup' }), channel({ id: 'dup' })], profiles: [] }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Duplicate channel id "dup"')
    expect(channelRepo.list()).toEqual([])
  })

  it('rejects an unknown channel type, naming it, and writes nothing', async () => {
    const { app, channelRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [channel({ id: 'acme-x', type: 'carrier-pigeon' })], profiles: [] }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Channel "acme-x" has unknown type "carrier-pigeon"')
    expect(channelRepo.list()).toEqual([])
  })

  it('rejects an enabled channel missing required config, naming instance + key, and writes nothing', async () => {
    const { app, channelRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [channel({ id: 'acme-slack', type: 'slack', config: {} })], profiles: [] }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Channel "acme-slack" is enabled but missing required config "SLACK_WEBHOOK_URL"')
    expect(channelRepo.list()).toEqual([])
  })

  it('rejects a profile default referencing a channel not in the payload, naming profile + ref, and writes nothing', async () => {
    const { app, channelRepo, profileRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        channels: [],
        profiles: [profile({ id: 'acme', token: 'tok', defaultChannels: ['ghost'] })]
      }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Profile "acme" has default channel "ghost" which does not exist')
    expect(channelRepo.list()).toEqual([])
    expect(profileRepo.list()).toEqual([])
  })

  it('rejects a profile default referencing a disabled channel, naming profile + ref, and writes nothing', async () => {
    const { app, profileRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        channels: [channel({ id: 'acme-ntfy', enabled: false })],
        profiles: [profile({ id: 'acme', token: 'tok', defaultChannels: ['acme-ntfy'] })]
      }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Profile "acme" has default channel "acme-ntfy" which is not enabled')
    expect(profileRepo.list()).toEqual([])
  })

  it('rejects duplicate profile tokens in the payload, and writes nothing', async () => {
    const { app, profileRepo } = makeApp()
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: {
        channels: [],
        profiles: [profile({ id: 'acme', token: 'shared' }), profile({ id: 'globex', token: 'shared' })]
      }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Duplicate token for profile "globex"')
    expect(profileRepo.list()).toEqual([])
  })

  it('a rejected write leaves a pre-existing config exactly as it was (nothing partially applied)', async () => {
    const channelRepo = new FakeChannelRepository([channel({ id: 'existing' })])
    const profileRepo = new FakeProfileRepository([profile({ id: 'existing', token: 'tok-existing' })])
    const { app } = makeApp({ channelRepo, profileRepo })
    current = app

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config',
      payload: { channels: [channel({ id: 'Bad Id' })], profiles: [] }
    })

    expect(res.statusCode).toBe(400)
    expect(channelRepo.list()).toEqual([channel({ id: 'existing' })])
    expect(profileRepo.list()).toEqual([profile({ id: 'existing', token: 'tok-existing' })])
  })
})
