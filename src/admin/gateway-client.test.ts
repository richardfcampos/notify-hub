/**
 * Tests derive from spec DBCH-07/08: gateway base URL/token derivation (no
 * more `.env`-derived AdminConfig -- token is whatever the caller resolved,
 * base URL a plain default or override), parallel health+channels fetch
 * degrading gracefully when the gateway is unreachable, the NEW `/channels`
 * shape (instance objects, not bare names), and the exact test-send request
 * shape (URL, auth header, channels array of instance ids).
 */
import { describe, expect, it } from 'vitest'
import { FakeHttpClient } from '../../test/helpers/fakes.js'
import { buildGatewayContext, fetchGatewayStatus, sendTestNotification } from './gateway-client.js'

describe('buildGatewayContext', () => {
  it('defaults to http://localhost:8080 when no override is given', () => {
    expect(buildGatewayContext('tok-phone')).toEqual({ baseUrl: 'http://localhost:8080', token: 'tok-phone' })
  })

  it('has no token when none is passed', () => {
    expect(buildGatewayContext(undefined).token).toBeUndefined()
  })

  it('uses the baseUrlOverride (ADMIN-08.4, NOTIFY_GATEWAY_URL) over the default localhost URL', () => {
    expect(buildGatewayContext('tok-phone', 'http://api:8080')).toEqual({
      baseUrl: 'http://api:8080',
      token: 'tok-phone'
    })
  })

  it('falls back to the default URL when baseUrlOverride is undefined or blank', () => {
    expect(buildGatewayContext('tok', undefined).baseUrl).toBe('http://localhost:8080')
    expect(buildGatewayContext('tok', '  ').baseUrl).toBe('http://localhost:8080')
  })
})

describe('fetchGatewayStatus', () => {
  it('returns up:true with redis + the new instance-shaped channels when both calls succeed', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok', redis: true }) })
    http.queueResponse({
      status: 200,
      body: JSON.stringify({
        channels: [{ id: 'acme-ntfy', label: 'Acme Ntfy', type: 'ntfy', enabled: true }],
        defaultChannels: ['acme-ntfy']
      })
    })

    const status = await fetchGatewayStatus(http, { baseUrl: 'http://localhost:8080', token: 'tok' })

    expect(status).toEqual({
      up: true,
      redis: true,
      channels: [{ id: 'acme-ntfy', label: 'Acme Ntfy', type: 'ntfy', enabled: true }],
      defaultChannels: ['acme-ntfy']
    })
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

  it('filters out malformed channel entries instead of throwing (edge case)', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 200, body: JSON.stringify({ status: 'ok' }) })
    http.queueResponse({
      status: 200,
      body: JSON.stringify({ channels: [{ id: 'ok-one', label: 'l', type: 't', enabled: true }, { bogus: true }] })
    })

    const status = await fetchGatewayStatus(http, { baseUrl: 'http://localhost:8080' })

    expect(status.channels).toEqual([{ id: 'ok-one', label: 'l', type: 't', enabled: true }])
  })
})

describe('sendTestNotification', () => {
  it('POSTs /notify with the exact title/message/channels (instance id) and Bearer token', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'abc' }) })

    const outcome = await sendTestNotification(http, { baseUrl: 'http://localhost:8080', token: 'tok-phone' }, 'acme-ntfy')

    expect(outcome).toEqual({ ok: true, status: 202 })
    expect(http.calls[0]).toEqual({
      method: 'POST',
      url: 'http://localhost:8080/notify',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-phone' },
      body: { title: 'notify-hub admin', message: 'Test from the admin panel', channels: ['acme-ntfy'] }
    })
  })

  it('returns ok:false with the status when the gateway rejects the request', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 401, body: '{}' })

    const outcome = await sendTestNotification(http, { baseUrl: 'http://localhost:8080', token: 'bad' }, 'acme-ntfy')

    expect(outcome.ok).toBe(false)
    expect(outcome.status).toBe(401)
  })

  it('returns ok:false with the error message instead of throwing when the gateway is unreachable (AC ADMIN-05.3)', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('ECONNREFUSED'))

    const outcome = await sendTestNotification(http, { baseUrl: 'http://localhost:8080' }, 'acme-ntfy')

    expect(outcome.ok).toBe(false)
    expect(outcome.errorMessage).toBe('ECONNREFUSED')
  })
})
