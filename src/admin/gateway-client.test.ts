/**
 * Tests derive from spec ADMIN-05/ADMIN-06: gateway base URL/token
 * derivation, parallel health+channels fetch degrading gracefully when the
 * gateway is unreachable, and the exact test-send request shape (URL,
 * auth header, channels array).
 */
import { describe, expect, it } from 'vitest'
import { FakeHttpClient } from '../../test/helpers/fakes.js'
import type { AdminConfig } from './admin-config.js'
import { buildGatewayContext, fetchGatewayStatus, sendTestNotification } from './gateway-client.js'

function baseCfg(overrides: Partial<AdminConfig> = {}): AdminConfig {
  return {
    channels: {},
    profiles: [{ name: 'phone', token: 'tok-phone', defaultChannels: ['ntfy'] }],
    extraKeys: {},
    ...overrides
  }
}

describe('buildGatewayContext', () => {
  it('defaults to http://localhost:8080 when extraKeys.PORT is absent', () => {
    expect(buildGatewayContext(baseCfg())).toEqual({ baseUrl: 'http://localhost:8080', token: 'tok-phone' })
  })

  it('uses extraKeys.PORT when present', () => {
    expect(buildGatewayContext(baseCfg({ extraKeys: { PORT: '9999' } }))).toEqual({
      baseUrl: 'http://localhost:9999',
      token: 'tok-phone'
    })
  })

  it('has no token when there are no profiles', () => {
    expect(buildGatewayContext(baseCfg({ profiles: [] })).token).toBeUndefined()
  })
})

describe('fetchGatewayStatus', () => {
  it('returns up:true with redis + channels when both calls succeed', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok', redis: true }) })
    http.queueResponse({
      status: 200,
      body: JSON.stringify({ channels: ['ntfy', 'slack'], defaultChannels: ['ntfy'] })
    })

    const status = await fetchGatewayStatus(http, { baseUrl: 'http://localhost:8080', token: 'tok' })

    expect(status).toEqual({ up: true, redis: true, channels: ['ntfy', 'slack'], defaultChannels: ['ntfy'] })
    expect(http.calls[0]).toEqual({ method: 'GET', url: 'http://localhost:8080/health', headers: undefined })
    expect(http.calls[1]).toEqual({
      method: 'GET',
      url: 'http://localhost:8080/channels',
      headers: { authorization: 'Bearer tok' }
    })
  })

  it('degrades to up:false with empty arrays when the gateway is unreachable (AC ADMIN-06.2)', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('ECONNREFUSED'))
    http.queueError(new Error('ECONNREFUSED'))

    const status = await fetchGatewayStatus(http, { baseUrl: 'http://localhost:8080', token: 'tok' })

    expect(status).toEqual({ up: false, redis: undefined, channels: [], defaultChannels: [] })
  })

  it('reports health up but empty channels when /channels alone fails (e.g. bad token)', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok', redis: false }) })
    http.queueResponse({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) })

    const status = await fetchGatewayStatus(http, { baseUrl: 'http://localhost:8080', token: 'bad' })

    expect(status).toEqual({ up: true, redis: false, channels: [], defaultChannels: [] })
  })
})

describe('sendTestNotification', () => {
  it('POSTs /notify with the exact title/message/channels and Bearer token', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'abc' }) })

    const outcome = await sendTestNotification(http, { baseUrl: 'http://localhost:8080', token: 'tok-phone' }, 'ntfy')

    expect(outcome).toEqual({ ok: true, status: 202 })
    expect(http.calls[0]).toEqual({
      method: 'POST',
      url: 'http://localhost:8080/notify',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-phone' },
      body: { title: 'notify-hub admin', message: 'Test from the admin panel', channels: ['ntfy'] }
    })
  })

  it('returns ok:false with the status when the gateway rejects the request', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 401, body: '{}' })

    const outcome = await sendTestNotification(http, { baseUrl: 'http://localhost:8080', token: 'bad' }, 'ntfy')

    expect(outcome.ok).toBe(false)
    expect(outcome.status).toBe(401)
  })

  it('returns ok:false with the error message instead of throwing when the gateway is unreachable (AC ADMIN-05.3)', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('ECONNREFUSED'))

    const outcome = await sendTestNotification(http, { baseUrl: 'http://localhost:8080' }, 'ntfy')

    expect(outcome.ok).toBe(false)
    expect(outcome.errorMessage).toBe('ECONNREFUSED')
  })
})
