/**
 * Real-client tests for PostHogTelemetryClient (spec TEL-01 AC3/AC5). Two
 * concerns no other test in the suite exercises:
 *
 * 1. AC5 / Edge-Case-3 (error-swallow): the underlying posthog-node client's
 *    `capture()`/`shutdown()` can throw/reject (network error, malformed
 *    response, SDK bug). `sendHeartbeat` must resolve regardless -- never
 *    reject -- and the failure must be logged, not silently dropped. Since
 *    `posthog-node` constructs the client inline with no seam, these tests
 *    use the `createClient` constructor injection point (see
 *    posthog-telemetry-client.ts) to substitute a client double whose
 *    methods throw/reject on demand.
 * 2. AC3 (exact literal payload): `distinctId` and `event` are asserted as
 *    exact literal values at the real `capture()` call site, not just via
 *    the pure `buildHeartbeatProperties` shape test.
 */
import { describe, expect, it, vi } from 'vitest'
import { PostHogTelemetryClient, type PostHogClient } from './posthog-telemetry-client.js'
import type { HeartbeatProperties } from './telemetry-port.js'

const HEARTBEAT_PROPS: HeartbeatProperties = {
  version: '1.2.3',
  channelTypesEnabled: ['ntfy', 'slack'],
  platform: 'linux'
}

/** Records every capture() call; shutdown() resolves unless scripted otherwise. */
function makeFakeClient(overrides: Partial<PostHogClient> = {}): {
  client: PostHogClient
  captureCalls: unknown[]
} {
  const captureCalls: unknown[] = []
  const client: PostHogClient = {
    capture: (event) => {
      captureCalls.push(event)
    },
    shutdown: async () => undefined,
    ...overrides
  }
  return { client, captureCalls }
}

describe('PostHogTelemetryClient.sendHeartbeat', () => {
  it('resolves (never rejects) and logs when capture() throws synchronously', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const boom = new Error('capture exploded')
      const { client } = makeFakeClient({
        capture: () => {
          throw boom
        }
      })
      const telemetryClient = new PostHogTelemetryClient(
        { apiKey: 'phc_test', distinctId: 'install-uuid' },
        () => client
      )

      await expect(telemetryClient.sendHeartbeat(HEARTBEAT_PROPS)).resolves.toBeUndefined()

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith('telemetry: failed to send heartbeat', boom)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('resolves (never rejects) and logs when shutdown() rejects asynchronously', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const boom = new Error('shutdown rejected')
      const { client } = makeFakeClient({
        shutdown: async () => {
          throw boom
        }
      })
      const telemetryClient = new PostHogTelemetryClient(
        { apiKey: 'phc_test', distinctId: 'install-uuid' },
        () => client
      )

      await expect(telemetryClient.sendHeartbeat(HEARTBEAT_PROPS)).resolves.toBeUndefined()

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith('telemetry: failed to send heartbeat', boom)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('resolves (never rejects) and logs when the client factory itself throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const boom = new Error('construction failed')
      const telemetryClient = new PostHogTelemetryClient(
        { apiKey: 'phc_test', distinctId: 'install-uuid' },
        () => {
          throw boom
        }
      )

      await expect(telemetryClient.sendHeartbeat(HEARTBEAT_PROPS)).resolves.toBeUndefined()

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith('telemetry: failed to send heartbeat', boom)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('calls capture with the exact literal distinctId and event name (AC3)', async () => {
    const { client, captureCalls } = makeFakeClient()
    const telemetryClient = new PostHogTelemetryClient(
      { apiKey: 'phc_test', distinctId: 'install-uuid-123' },
      () => client
    )

    await telemetryClient.sendHeartbeat(HEARTBEAT_PROPS)

    expect(captureCalls).toHaveLength(1)
    expect(captureCalls[0]).toMatchObject({
      distinctId: 'install-uuid-123',
      event: 'notify_hub_heartbeat'
    })
  })

  it('awaits shutdown() before resolving on the happy path', async () => {
    let shutdownCalled = false
    const { client } = makeFakeClient({
      shutdown: async () => {
        shutdownCalled = true
      }
    })
    const telemetryClient = new PostHogTelemetryClient(
      { apiKey: 'phc_test', distinctId: 'install-uuid' },
      () => client
    )

    await telemetryClient.sendHeartbeat(HEARTBEAT_PROPS)

    expect(shutdownCalled).toBe(true)
  })
})
