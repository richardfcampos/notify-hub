/**
 * Talks to the running gateway (DBCH-08/09, tasks.md D9) over the injected
 * HttpClient port -- never a direct fetch call, so tests substitute
 * FakeHttpClient. `buildGatewayContext` no longer derives anything from a
 * parsed `.env` model (that model is gone): the base URL defaults to
 * `http://localhost:8080` (the gateway's own default port) unless
 * `baseUrlOverride` is given (wired from `NOTIFY_GATEWAY_URL` in compose
 * mode, where the gateway lives at `http://api:<port>` instead of
 * localhost); the token is whatever the caller resolved (the spec's "first
 * profile's token", read live from ProfileRepository).
 */
import type { HttpClient } from '../core/ports.js'

export interface GatewayContext {
  baseUrl: string
  token?: string
}

const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:8080'

export function buildGatewayContext(token: string | undefined, baseUrlOverride?: string): GatewayContext {
  return {
    baseUrl: baseUrlOverride?.trim() || DEFAULT_GATEWAY_BASE_URL,
    token
  }
}

/** One named channel instance as reported by the gateway's `GET /channels` (spec DBCH-07). */
export interface GatewayChannelSummary {
  id: string
  label: string
  type: string
  enabled: boolean
}

export interface GatewayStatus {
  up: boolean
  redis?: boolean
  channels: GatewayChannelSummary[]
  defaultChannels: string[]
}

function authHeaders(token?: string): Record<string, string> | undefined {
  return token ? { authorization: `Bearer ${token}` } : undefined
}

function isGatewayChannelSummary(value: unknown): value is GatewayChannelSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).label === 'string' &&
    typeof (value as Record<string, unknown>).type === 'string' &&
    typeof (value as Record<string, unknown>).enabled === 'boolean'
  )
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

  let channels: GatewayChannelSummary[] = []
  let defaultChannels: string[] = []
  if (channelsResult.status === 'fulfilled' && channelsResult.value.status === 200) {
    try {
      const parsed: unknown = JSON.parse(channelsResult.value.body)
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as { channels?: unknown; defaultChannels?: unknown }
        channels = Array.isArray(obj.channels) ? obj.channels.filter(isGatewayChannelSummary) : []
        defaultChannels = Array.isArray(obj.defaultChannels) ? obj.defaultChannels.filter((c) => typeof c === 'string') : []
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

/** POSTs a test notification targeting exactly one channel INSTANCE id (ADMIN-05.1). Network failure -> `{ok:false, errorMessage}` instead of throwing, so the route never hangs (ADMIN-05.3). */
export async function sendTestNotification(
  http: HttpClient,
  { baseUrl, token }: GatewayContext,
  channelId: string
): Promise<NotifyOutcome> {
  try {
    const res = await http.request({
      method: 'POST',
      url: `${baseUrl}/notify`,
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: {
        title: 'notify-hub admin',
        message: 'Test from the admin panel',
        channels: [channelId]
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
