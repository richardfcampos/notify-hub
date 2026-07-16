/**
 * e2e via `app.inject` with FakeHttpClient + FakeCommandRunner + a seeded
 * FakeChannelRepository/FakeProfileRepository (ADMIN-05, rewired to named
 * channel INSTANCES by tasks.md D9). Derived from spec P1 "Per-channel test
 * send" ACs: real request shape to the gateway (URL, auth header, channels
 * array of the instance id), success/failure outcome surfaced from worker
 * logs keyed by instance id, unknown/disabled instance -> 400, and
 * gateway-down reporting fast instead of hanging. `delay` is a no-op and
 * `testSendPollAttempts` is small so the poll loop runs instantly and
 * deterministically in tests.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeChannelRepository, FakeCommandRunner, FakeHttpClient, FakeProfileRepository } from '../../../test/helpers/fakes.js'
import type { ChannelInstance } from '../../core/types.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'

function channel(over: Partial<ChannelInstance> & { id: string }): ChannelInstance {
  return { label: over.id, type: 'ntfy', enabled: true, config: {}, ...over }
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
  http: FakeHttpClient
  commandRunner: FakeCommandRunner
} {
  const http = (overrides.http as FakeHttpClient) ?? new FakeHttpClient()
  const commandRunner = (overrides.commandRunner as FakeCommandRunner) ?? new FakeCommandRunner()
  const deps: AdminServerDeps = {
    channelRepo: new FakeChannelRepository([channel({ id: 'acme-ntfy' }), channel({ id: 'acme-slack', type: 'slack', enabled: false })]),
    profileRepo: new FakeProfileRepository([
      { id: 'phone', name: 'phone', token: 'tok-phone', defaultChannels: ['acme-ntfy'] }
    ]),
    http,
    commandRunner,
    testSendPollAttempts: 3,
    testSendPollIntervalMs: 1,
    delay: async () => {},
    ...overrides
  }
  return { app: buildAdminServer(deps), http, commandRunner }
}

describe('POST /api/test-send', () => {
  it('sends the exact gateway request (URL, Bearer token, channels by instance id) and reports success from worker logs', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({ time: Date.now() + 1000, channel: 'acme-ntfy', msg: 'notification sent' })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'acme-ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, detail: 'sent' })
    expect(http.calls[0]).toEqual({
      method: 'POST',
      url: 'http://localhost:8080/notify',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-phone' },
      body: { title: 'notify-hub admin', message: 'Test from the admin panel', channels: ['acme-ntfy'] }
    })
  })

  it('polls the worker-log tail from the injected composeDir instead of the bare process cwd (ADMIN-08.3)', async () => {
    const { app, http, commandRunner } = makeApp({ composeDir: '/config' })
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({ time: Date.now() + 1000, channel: 'acme-ntfy', msg: 'notification sent' })}`,
      stderr: ''
    })

    await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'acme-ntfy' } })

    expect(commandRunner.calls[0]?.opts).toEqual({ cwd: '/config' })
  })

  it('surfaces the real failure reason from worker logs (instance-failure case)', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({
        time: Date.now() + 1000,
        channel: 'acme-ntfy',
        error: 'CallMeBot: invalid apikey',
        msg: 'delivery failed for channel "acme-ntfy"'
      })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'acme-ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, detail: 'CallMeBot: invalid apikey' })
  })

  it('reports gateway-down fast instead of hanging (AC ADMIN-05.3)', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueError(new Error('ECONNREFUSED'))

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'acme-ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, detail: 'gateway unreachable: ECONNREFUSED' })
  })

  it('returns ok:false when no matching log line ever appears (poll exhausted)', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.defaultResult = { code: 0, stdout: '', stderr: '' }

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'acme-ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, detail: 'no delivery result observed within timeout' })
    expect(commandRunner.calls.length).toBe(3)
  })

  it('rejects an unknown instance id with 400', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'carrier-pigeon' } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('unknown channel "carrier-pigeon"')
  })

  it('rejects a disabled instance with 400', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channelId: 'acme-slack' } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('channel "acme-slack" is not enabled')
  })

  it('rejects a missing channelId field with 400', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: {} })

    expect(res.statusCode).toBe(400)
  })
})
