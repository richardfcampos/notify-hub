/**
 * e2e via `app.inject` with FakeHttpClient + FakeCommandRunner (ADMIN-05).
 * Derived from spec P1 "Per-channel test send" ACs: real request shape to
 * the gateway (URL, auth header, channels array), success/failure outcome
 * surfaced from worker logs, and gateway-down reporting fast instead of
 * hanging. `delay` is a no-op and `testSendPollAttempts` is small so the
 * poll loop runs instantly and deterministically in tests.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeCommandRunner, FakeFileStore, FakeHttpClient } from '../../../test/helpers/fakes.js'
import type { ChannelSchema } from '../admin-config.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'

const registry: Record<string, ChannelSchema> = {
  ntfy: { requiredConfig: ['NTFY_URL', 'NTFY_TOPIC'] },
  slack: { requiredConfig: ['SLACK_WEBHOOK_URL'] }
}
const ENV = [
  'CHANNELS_ENABLED=ntfy',
  'TOKENS=phone:tok-phone:ntfy',
  'NTFY_URL=https://ntfy.sh',
  'NTFY_TOPIC=t',
  'SLACK_WEBHOOK_URL='
].join('\n')

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
    fileStore: new FakeFileStore(ENV),
    registry,
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
  it('sends the exact gateway request (URL, Bearer token, channels) and reports success from worker logs', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({ time: Date.now() + 1000, channel: 'ntfy', msg: 'notification sent' })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channel: 'ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, detail: 'sent' })
    expect(http.calls[0]).toEqual({
      method: 'POST',
      url: 'http://localhost:8080/notify',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-phone' },
      body: { title: 'notify-hub admin', message: 'Test from the admin panel', channels: ['ntfy'] }
    })
  })

  it('surfaces the real failure reason from worker logs (channel-failure case)', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({
        time: Date.now() + 1000,
        channel: 'ntfy',
        error: 'CallMeBot: invalid apikey',
        msg: 'delivery failed for channel "ntfy"'
      })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channel: 'ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, detail: 'CallMeBot: invalid apikey' })
  })

  it('reports gateway-down fast instead of hanging (AC ADMIN-05.3)', async () => {
    const { app, http } = makeApp()
    current = app
    http.queueError(new Error('ECONNREFUSED'))

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channel: 'ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, detail: 'gateway unreachable: ECONNREFUSED' })
  })

  it('returns ok:false when no matching log line ever appears (poll exhausted)', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
    commandRunner.defaultResult = { code: 0, stdout: '', stderr: '' }

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channel: 'ntfy' } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: false, detail: 'no delivery result observed within timeout' })
    expect(commandRunner.calls.length).toBe(3)
  })

  it('rejects an unknown channel with 400', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channel: 'carrier-pigeon' } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('unknown channel "carrier-pigeon"')
  })

  it('rejects a disabled channel with 400', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: { channel: 'slack' } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('channel "slack" is not enabled')
  })

  it('rejects a missing channel field with 400', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/test-send', payload: {} })

    expect(res.statusCode).toBe(400)
  })
})
