/**
 * e2e via `app.inject` with FakeHttpClient + FakeCommandRunner + a seeded
 * FakeProfileRepository (ADMIN-06, rewired to DBCH-07's `/channels` shape).
 * Derived from spec P1 "System status" AC1/AC2: health + instance channels +
 * recent worker deliveries in one response; gateway-down degrades cleanly
 * instead of breaking the rest of the panel.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeChannelRepository, FakeCommandRunner, FakeHttpClient, FakeProfileRepository } from '../../../test/helpers/fakes.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

function makeApp(overrides: Partial<AdminServerDeps> = {}): {
  app: FastifyInstance
  http: FakeHttpClient
  commandRunner: FakeCommandRunner
} {
  const http = (overrides.http as FakeHttpClient) ?? new FakeHttpClient()
  const commandRunner = (overrides.commandRunner as FakeCommandRunner) ?? new FakeCommandRunner()
  const deps: AdminServerDeps = {
    channelRepo: new FakeChannelRepository(),
    profileRepo: new FakeProfileRepository([
      { id: 'phone', name: 'phone', token: 'tok-phone', defaultChannels: ['acme-ntfy'] }
    ]),
    http,
    commandRunner,
    ...overrides
  }
  return { app: buildAdminServer(deps), http, commandRunner }
}

describe('GET /api/status', () => {
  it('returns gateway up + the new instance-shaped channels + parsed recent deliveries', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok', redis: true }) })
    http.queueResponse({
      status: 200,
      body: JSON.stringify({
        channels: [{ id: 'acme-ntfy', label: 'Acme Ntfy', type: 'ntfy', enabled: true }],
        defaultChannels: ['acme-ntfy']
      })
    })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({ time: 1700000000000, channel: 'acme-ntfy', msg: 'notification sent' })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'GET', url: '/api/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      gateway: { up: true, redis: true },
      channels: [{ id: 'acme-ntfy', label: 'Acme Ntfy', type: 'ntfy', enabled: true }],
      defaultChannels: ['acme-ntfy'],
      recentDeliveries: [{ channel: 'acme-ntfy', ok: true, time: new Date(1700000000000).toISOString() }]
    })
  })

  it('uses the first profile token from ProfileRepository for the /channels auth header', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok' }) })
    http.queueResponse({ status: 200, body: JSON.stringify({ channels: [], defaultChannels: [] }) })

    await app.inject({ method: 'GET', url: '/api/status' })

    expect(http.calls[1]?.headers).toEqual({ authorization: 'Bearer tok-phone' })
  })

  it('runs the worker-log tail from the injected composeDir instead of the bare process cwd (ADMIN-08.3)', async () => {
    const { app, http, commandRunner } = makeApp({ composeDir: '/config' })
    current = app
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok' }) })
    http.queueResponse({ status: 200, body: JSON.stringify({ channels: [], defaultChannels: [] }) })
    commandRunner.queueResult({ code: 0, stdout: '', stderr: '' })

    await app.inject({ method: 'GET', url: '/api/status' })

    expect(commandRunner.calls[0]?.opts).toEqual({ cwd: '/config' })
  })

  it('reports gateway down without breaking the rest of the response (AC ADMIN-06.2)', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueError(new Error('ECONNREFUSED'))
    http.queueError(new Error('ECONNREFUSED'))
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({
        time: 1,
        channel: 'acme-slack',
        error: 'bad url',
        msg: 'delivery failed for channel "acme-slack"'
      })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'GET', url: '/api/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      gateway: { up: false },
      channels: [],
      defaultChannels: [],
      recentDeliveries: [{ channel: 'acme-slack', ok: false, error: 'bad url', time: new Date(1).toISOString() }]
    })
  })

  it('degrades to gateway down (no http/commandRunner configured) instead of throwing', async () => {
    const { app } = makeApp({ http: undefined, commandRunner: undefined })
    current = app

    const res = await app.inject({ method: 'GET', url: '/api/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ gateway: { up: false }, channels: [], defaultChannels: [], recentDeliveries: [] })
  })
})
