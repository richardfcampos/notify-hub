/**
 * Shared test-send orchestration (spec ADMIN-05, MCPC-04): validates the
 * channel instance exists and is enabled, sends a real test notification to
 * the running gateway using the first profile's token, then polls the
 * worker's delivery logs for the actual outcome (proving delivery
 * end-to-end, not just "enqueued"). Used by both `POST /api/test-send`
 * (routes/test-send-route.ts, mapped to HTTP status codes) and the MCP
 * `test_channel` tool (register-config-tools.ts, mapped to isError results)
 * so the two surfaces can never drift. Gateway down/timeout -> a `result`
 * outcome fast, never a hang: the poll loop is bounded and its delay is
 * injectable so tests run instantly instead of the ~10s real total.
 */
import type { ChannelRepository, HttpClient, ProfileRepository } from '../core/ports.js'
import type { CommandRunner } from './command-runner.js'
import { buildGatewayContext, sendTestNotification } from './gateway-client.js'
import { fetchWorkerDeliveryEvents } from './worker-logs.js'

export interface TestSendDeps {
  channelRepo: ChannelRepository
  profileRepo: ProfileRepository
  http?: HttpClient
  commandRunner?: CommandRunner
  composeDir?: string
  gatewayBaseUrl?: string
  testSendPollAttempts?: number
  testSendPollIntervalMs?: number
  delay?: (ms: number) => Promise<void>
}

/**
 * `not_found`/`disabled` are precondition failures on the request itself
 * (bad instance id); `misconfigured` is a server wiring problem (no
 * HttpClient injected); `result` is the actual send/poll outcome (`ok` may
 * legitimately be false -- gateway unreachable, no CommandRunner, poll
 * timeout, or a real delivery failure -- all still a "result", not a
 * request error).
 */
export type TestSendOutcome =
  | { kind: 'not_found'; message: string }
  | { kind: 'disabled'; message: string }
  | { kind: 'misconfigured'; message: string }
  | { kind: 'result'; ok: boolean; detail: string }

const DEFAULT_POLL_ATTEMPTS = 10
const DEFAULT_POLL_INTERVAL_MS = 1000

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runTestSend(deps: TestSendDeps, channelId: string): Promise<TestSendOutcome> {
  const channel = deps.channelRepo.get(channelId)
  if (!channel) {
    return { kind: 'not_found', message: `unknown channel "${channelId}"` }
  }
  if (!channel.enabled) {
    return { kind: 'disabled', message: `channel "${channelId}" is not enabled` }
  }
  if (!deps.http) {
    return { kind: 'misconfigured', message: 'admin server misconfigured: no HttpClient provided' }
  }

  const token = deps.profileRepo.list()[0]?.token
  const gatewayContext = buildGatewayContext(token, deps.gatewayBaseUrl)
  const sentAt = Date.now()

  const notifyOutcome = await sendTestNotification(deps.http, gatewayContext, channelId)
  if (!notifyOutcome.ok) {
    return { kind: 'result', ok: false, detail: `gateway unreachable: ${notifyOutcome.errorMessage}` }
  }

  if (!deps.commandRunner) {
    return { kind: 'result', ok: false, detail: 'no CommandRunner configured to observe the delivery outcome' }
  }

  const attempts = deps.testSendPollAttempts ?? DEFAULT_POLL_ATTEMPTS
  const intervalMs = deps.testSendPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const delay = deps.delay ?? realDelay

  for (let attempt = 0; attempt < attempts; attempt++) {
    const events = await fetchWorkerDeliveryEvents(deps.commandRunner, deps.composeDir ?? process.cwd())
    const match = events
      .filter((event) => event.channel === channelId && (!event.time || Date.parse(event.time) >= sentAt))
      .at(-1)

    if (match) {
      return { kind: 'result', ok: match.ok, detail: match.ok ? 'sent' : (match.error ?? 'delivery failed') }
    }

    if (attempt < attempts - 1) {
      await delay(intervalMs)
    }
  }

  return { kind: 'result', ok: false, detail: 'no delivery result observed within timeout' }
}
