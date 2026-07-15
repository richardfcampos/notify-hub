/**
 * e2e via Fastify `app.inject` (no listener) with an in-memory FakeFileStore
 * (ADMIN-01, ADMIN-02, ADMIN-03). Derived from spec ACs: GET reflects the
 * seeded `.env`; PUT rejects an enabled-channel-missing-key body and a
 * profile-default-channel-not-enabled body (both named, nothing written);
 * PUT valid backs up then writes a round-trippable `.env`. A separate
 * describe block starts a real listener on an ephemeral port to assert the
 * 127.0.0.1-only binding (ADMIN-01 security AC).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeFileStore } from '../../test/helpers/fakes.js'
import type { AdminConfig, ChannelSchema } from './admin-config.js'
import { buildAdminServer, startAdminServer, type AdminServerDeps } from './admin-server.js'

const registry: Record<string, ChannelSchema> = {
  ntfy: { requiredConfig: ['NTFY_URL', 'NTFY_TOPIC'] },
  slack: { requiredConfig: ['SLACK_WEBHOOK_URL'] }
}

function makeApp(overrides: Partial<AdminServerDeps> = {}): {
  app: FastifyInstance
  fileStore: FakeFileStore
} {
  const fileStore = overrides.fileStore instanceof FakeFileStore ? overrides.fileStore : new FakeFileStore()
  const deps: AdminServerDeps = { fileStore, registry, ...overrides }
  return { app: buildAdminServer(deps), fileStore }
}

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

describe('GET /api/config', () => {
  it('reflects the seeded .env content', async () => {
    const fileStore = new FakeFileStore(
      ['CHANNELS_ENABLED=ntfy', 'NTFY_URL=https://ntfy.sh', 'NTFY_TOPIC=mytopic', 'TOKENS=phone:tok:ntfy'].join('\n')
    )
    const { app } = makeApp({ fileStore })
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/config' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      channels: {
        ntfy: { enabled: true, values: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'mytopic' } },
        slack: { enabled: false, values: { SLACK_WEBHOOK_URL: '' } }
      },
      profiles: [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy'] }],
      extraKeys: {}
    })
  })

  it('returns the empty model when no .env exists yet', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/config' })

    expect(res.statusCode).toBe(200)
    expect(res.json().channels.ntfy).toEqual({ enabled: false, values: { NTFY_URL: '', NTFY_TOPIC: '' } })
  })
})

describe('PUT /api/config', () => {
  function validConfig(): AdminConfig {
    return {
      channels: {
        ntfy: { enabled: true, values: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'mytopic' } },
        slack: { enabled: false, values: { SLACK_WEBHOOK_URL: '' } }
      },
      profiles: [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy'] }],
      extraKeys: { PORT: '8080' }
    }
  }

  it('rejects an enabled channel missing a required key, naming channel + key, and writes nothing', async () => {
    const { app, fileStore } = makeApp()
    current = app
    const before = fileStore.content

    const cfg = validConfig()
    cfg.channels.slack = { enabled: true, values: { SLACK_WEBHOOK_URL: '' } }

    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: cfg })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Channel "slack" is enabled but missing required config "SLACK_WEBHOOK_URL"')
    expect(fileStore.content).toBe(before)
    expect(fileStore.backups).toHaveLength(0)
  })

  it('rejects a profile default channel that is not enabled, naming it, and writes nothing', async () => {
    const { app, fileStore } = makeApp()
    current = app
    const before = fileStore.content

    const cfg = validConfig()
    cfg.profiles = [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy', 'slack'] }]

    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: cfg })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('Profile "phone" has default channel "slack" which is not enabled')
    expect(fileStore.content).toBe(before)
    expect(fileStore.backups).toHaveLength(0)
  })

  it('rejects a malformed body (400) and writes nothing', async () => {
    const { app, fileStore } = makeApp()
    current = app

    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { nonsense: true } })

    expect(res.statusCode).toBe(400)
    expect(fileStore.content).toBeNull()
  })

  it('backs up then writes a round-trippable .env on a valid body', async () => {
    const fileStore = new FakeFileStore('CHANNELS_ENABLED=\nTOKENS=\n')
    const { app } = makeApp({ fileStore })
    current = app

    const cfg = validConfig()
    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: cfg })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(fileStore.backups).toEqual(['fake-backup-1'])
    expect(body.backupPath).toBe('fake-backup-1')

    // The freshly written content parses back to the exact config that was saved.
    const getRes = await app.inject({ method: 'GET', url: '/api/config' })
    expect(getRes.json()).toEqual(cfg)
  })
})

describe('static UI serving', () => {
  let dir: string

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serves admin.html at / when uiDir is provided', async () => {
    dir = await mkdtemp(join(tmpdir(), 'notify-hub-admin-ui-'))
    await writeFile(join(dir, 'admin.html'), '<html>admin</html>')
    const { app } = makeApp({ uiDir: dir })
    current = app

    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toBe('<html>admin</html>')
  })

  it('returns 404 for a file that does not exist under uiDir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'notify-hub-admin-ui-'))
    const { app } = makeApp({ uiDir: dir })
    current = app

    const res = await app.inject({ method: 'GET', url: '/missing.js' })

    expect(res.statusCode).toBe(404)
  })

  it('returns 403 for a path attempting to escape uiDir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'notify-hub-admin-ui-'))
    const { app } = makeApp({ uiDir: dir })
    current = app

    const res = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' })

    expect(res.statusCode).toBe(403)
  })

  it('has no static route registered when uiDir is omitted (unmatched GET / is a plain 404)', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(404)
  })
})

describe('startAdminServer binding', () => {
  it('defaults to host 127.0.0.1 (never 0.0.0.0) when no host option is given -- the invariant for host mode', async () => {
    const fileStore = new FakeFileStore()
    // Port 0 lets the OS pick a free ephemeral port so this test never
    // collides with anything already listening on 8081.
    const app = await startAdminServer({ fileStore, registry }, { port: 0 })
    current = app

    const address = app.server.address()
    expect(address).not.toBeNull()
    expect(typeof address === 'object' && address !== null ? address.address : null).toBe('127.0.0.1')
  })

  it('honors an explicit host option (ADMIN-01.2: container mode passes ADMIN_HOST=0.0.0.0)', async () => {
    const fileStore = new FakeFileStore()
    const app = await startAdminServer({ fileStore, registry }, { port: 0, host: '0.0.0.0' })
    current = app

    const address = app.server.address()
    expect(typeof address === 'object' && address !== null ? address.address : null).toBe('0.0.0.0')
  })
})
