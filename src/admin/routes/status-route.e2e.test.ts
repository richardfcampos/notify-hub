/**
 * e2e via `app.inject` with FakeHttpClient + FakeCommandRunner (ADMIN-06).
 * Derived from spec P1 "System status" AC1/AC2: health + channels + recent
 * worker deliveries in one response; gateway-down degrades cleanly instead
 * of breaking the rest of the panel.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeCommandRunner, FakeFileStore, FakeHttpClient } from '../../../test/helpers/fakes.js'
import type { ChannelSchema } from '../admin-config.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'

const registry: Record<string, ChannelSchema> = { ntfy: { requiredConfig: ['NTFY_URL', 'NTFY_TOPIC'] } }
const ENV = ['CHANNELS_ENABLED=ntfy', 'TOKENS=phone:tok-phone:ntfy', 'NTFY_URL=https://ntfy.sh', 'NTFY_TOPIC=t'].join(
  '\n'
)

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
    ...overrides
  }
  return { app: buildAdminServer(deps), http, commandRunner }
}

describe('GET /api/status', () => {
  it('returns gateway up + channels + parsed recent deliveries', async () => {
    const { app, http, commandRunner } = makeApp()
    current = app
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok', redis: true }) })
    http.queueResponse({ status: 200, body: JSON.stringify({ channels: ['ntfy'], defaultChannels: ['ntfy'] }) })
    commandRunner.queueResult({
      code: 0,
      stdout: `worker-1 | ${JSON.stringify({ time: 1700000000000, channel: 'ntfy', msg: 'notification sent' })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'GET', url: '/api/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      gateway: { up: true, redis: true },
      channels: ['ntfy'],
      defaultChannels: ['ntfy'],
      recentDeliveries: [{ channel: 'ntfy', ok: true, time: new Date(1700000000000).toISOString() }]
    })
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
        channel: 'slack',
        error: 'bad url',
        msg: 'delivery failed for channel "slack"'
      })}`,
      stderr: ''
    })

    const res = await app.inject({ method: 'GET', url: '/api/status' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      gateway: { up: false },
      channels: [],
      defaultChannels: [],
      recentDeliveries: [{ channel: 'slack', ok: false, error: 'bad url', time: new Date(1).toISOString() }]
    })
  })
})
