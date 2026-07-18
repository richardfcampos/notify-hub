/**
 * Every disable path returns a NoopTelemetryClient (spec TEL-01 AC1/AC4) --
 * asserted via `instanceof`, never by invoking `sendHeartbeat` or touching
 * the network. The enabled+keyed path returns a PostHogTelemetryClient
 * instance too, but construction alone never touches the network: the real
 * posthog-node client is only built lazily inside `sendHeartbeat`, which
 * this test deliberately never calls.
 */
import { describe, expect, it } from 'vitest'
import { buildTelemetryClient } from './build-telemetry-client.js'
import { NoopTelemetryClient } from './noop-telemetry-client.js'
import { PostHogTelemetryClient } from './posthog-telemetry-client.js'

describe('buildTelemetryClient', () => {
  it('returns Noop when TELEMETRY_ENABLED is unset', () => {
    const client = buildTelemetryClient({ env: { POSTHOG_API_KEY: 'phc_test' }, distinctId: 'abc' })
    expect(client).toBeInstanceOf(NoopTelemetryClient)
  })

  it('returns Noop when DO_NOT_TRACK overrides an explicit TELEMETRY_ENABLED=true', () => {
    const client = buildTelemetryClient({
      env: { TELEMETRY_ENABLED: 'true', DO_NOT_TRACK: '1', POSTHOG_API_KEY: 'phc_test' },
      distinctId: 'abc'
    })
    expect(client).toBeInstanceOf(NoopTelemetryClient)
  })

  it('returns Noop when POSTHOG_API_KEY is unset even though telemetry is enabled', () => {
    const client = buildTelemetryClient({ env: { TELEMETRY_ENABLED: 'true' }, distinctId: 'abc' })
    expect(client).toBeInstanceOf(NoopTelemetryClient)
  })

  it('returns Noop when POSTHOG_API_KEY is an empty string', () => {
    const client = buildTelemetryClient({
      env: { TELEMETRY_ENABLED: 'true', POSTHOG_API_KEY: '' },
      distinctId: 'abc'
    })
    expect(client).toBeInstanceOf(NoopTelemetryClient)
  })

  it('returns a PostHogTelemetryClient when enabled and a key is present (never invoked here -> no network call)', () => {
    const client = buildTelemetryClient({
      env: { TELEMETRY_ENABLED: 'true', POSTHOG_API_KEY: 'phc_test' },
      distinctId: 'abc'
    })
    expect(client).toBeInstanceOf(PostHogTelemetryClient)
  })
})
