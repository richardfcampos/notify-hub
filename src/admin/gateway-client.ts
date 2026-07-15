/**
 * Talks to the running gateway (ADMIN-05, ADMIN-06) over the injected
 * HttpClient port -- never a direct fetch call, so tests substitute
 * FakeHttpClient. `buildGatewayContext` derives the base URL from the
 * admin config's `extraKeys.PORT` (defaulting to 8080, the gateway's own
 * default) and picks the first profile's token, matching the spec
 * assumption "test-send uses the first profile's token".
 */
import type { HttpClient } from '../core/ports.js'
import type { AdminConfig } from './admin-config.js'

export interface GatewayContext {
  baseUrl: string
  token?: string
}

export function buildGatewayContext(cfg: AdminConfig): GatewayContext {
  const port = cfg.extraKeys.PORT?.trim() || '8080'
  return {
    baseUrl: `http://localhost:${port}`,
    token: cfg.profiles[0]?.token
  }
}

export interface GatewayStatus {
  up: boolean
  redis?: boolean
  channels: string[]
  defaultChannels: string[]
}

function authHeaders(token?: string): Record<string, string> | undefined {
  return token ? { authorization: `Bearer ${token}` } : undefined
}

/**
 * Fetches gateway `/health` and `/channels` concurrently (ADMIN-06.1).
 * Never throws: any failure (network error, non-200, unparseable body)
 * degrades that portion of the result rather than rejecting the whole
 * status response (ADMIN-06.2, "gateway unreachable -> down without
 * breaking the rest of the panel").
 */
export async function fetchGatewayStatus(
  http: HttpClient,
  { baseUrl, token }: GatewayContext
): Promise<GatewayStatus> {
  const [healthResult, channelsResult] = await Promise.allSettled([
    http.request({ method: 'GET', url: `${baseUrl}/health` }),
    http.request({ method: 'GET', url: `${baseUrl}/channels`, headers: authHeaders(token) })
  ])

  let up = false
  let redis: boolean | undefined
  if (healthResult.status === 'fulfilled' && healthResult.value.status === 200) {
    up = true
    try {
      const health: unknown = JSON.parse(healthResult.value.body)
      if (typeof health === 'object' && health !== null && 'redis' in health) {
        redis = Boolean((health as { redis: unknown }).redis)
      }
    } catch {
      // Health endpoint reachable but body unparseable; `up` stays true, `redis` stays undefined.
    }
  }

  let channels: string[] = []
  let defaultChannels: string[] = []
  if (channelsResult.status === 'fulfilled' && channelsResult.value.status === 200) {
    try {
      const parsed: unknown = JSON.parse(channelsResult.value.body)
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as { channels?: unknown; defaultChannels?: unknown }
        channels = Array.isArray(obj.channels) ? obj.channels : []
        defaultChannels = Array.isArray(obj.defaultChannels) ? obj.defaultChannels : []
      }
    } catch {
      // Channels endpoint reachable but body unparseable; arrays stay empty.
    }
  }

  return { up, redis, channels, defaultChannels }
}

export interface NotifyOutcome {
  ok: boolean
  status?: number
  errorMessage?: string
}

/** POSTs a test notification targeting exactly one channel (ADMIN-05.1). Network failure -> `{ok:false, errorMessage}` instead of throwing, so the route never hangs (ADMIN-05.3). */
export async function sendTestNotification(
  http: HttpClient,
  { baseUrl, token }: GatewayContext,
  channel: string
): Promise<NotifyOutcome> {
  try {
    const res = await http.request({
      method: 'POST',
      url: `${baseUrl}/notify`,
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: {
        title: 'notify-hub admin',
        message: 'Test from the admin panel',
        channels: [channel]
      }
    })
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, errorMessage: `gateway rejected the test notification (status ${res.status})` }
    }
    return { ok: true, status: res.status }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
  }
}
