/**
 * e2e via Fastify `app.inject` (config CRUD assertions live in
 * routes/config-routes.e2e.test.ts). This file covers what buildAdminServer
 * itself is responsible for: serving the static UI directory (or not, when
 * uiDir is omitted) and the loopback-only host binding invariant
 * (ADMIN-01 security AC) via a real listener on an ephemeral port.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeChannelRepository, FakeProfileRepository } from '../../test/helpers/fakes.js'
import { buildAdminServer, startAdminServer, type AdminServerDeps } from './admin-server.js'

function makeApp(overrides: Partial<AdminServerDeps> = {}): { app: FastifyInstance } {
  const deps: AdminServerDeps = {
    channelRepo: new FakeChannelRepository(),
    profileRepo: new FakeProfileRepository(),
    ...overrides
  }
  return { app: buildAdminServer(deps) }
}

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
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
    // Port 0 lets the OS pick a free ephemeral port so this test never
    // collides with anything already listening on 8081.
    const app = await startAdminServer(
      { channelRepo: new FakeChannelRepository(), profileRepo: new FakeProfileRepository() },
      { port: 0 }
    )
    current = app

    const address = app.server.address()
    expect(address).not.toBeNull()
    expect(typeof address === 'object' && address !== null ? address.address : null).toBe('127.0.0.1')
  })

  it('honors an explicit host option (ADMIN-01.2: container mode passes ADMIN_HOST=0.0.0.0)', async () => {
    const app = await startAdminServer(
      { channelRepo: new FakeChannelRepository(), profileRepo: new FakeProfileRepository() },
      { port: 0, host: '0.0.0.0' }
    )
    current = app

    const address = app.server.address()
    expect(typeof address === 'object' && address !== null ? address.address : null).toBe('0.0.0.0')
  })
})
