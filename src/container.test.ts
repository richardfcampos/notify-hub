/**
 * Boot-wiring tests for the telemetry heartbeat (spec TEL-03, Edge Cases):
 * a rejecting telemetry client must never crash/block container wiring
 * (Edge Cases: "MUST NOT crash or delay api/worker boot"), and the
 * heartbeat fires exactly once per buildContainer() call carrying the
 * deduplicated enabled channel TYPES only (never instance ids/labels).
 * Everything else is injected (InMemoryQueue, fake repos/http/mail/logger)
 * so this never touches SQLite/Redis/SMTP/PostHog.
 */
import { describe, expect, it } from 'vitest'
import { buildContainer } from './container.js'
import type { AppConfig, ChannelInstance } from './core/types.js'
import { InMemoryQueue } from './queue/in-memory-queue.js'
import {
  FakeChannelRepository,
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport,
  FakeProfileRepository,
  FakeTelemetryClient
} from '../test/helpers/fakes.js'

const config: AppConfig = {
  port: 3000,
  redisUrl: 'redis://unused',
  dbPath: ':memory:', // unused: repos are injected below
  profiles: [],
  channelsEnabled: [],
  channelConfig: {},
  retry: { attempts: 3, backoffMs: 100 }
}

function instance(id: string, type: string, enabled = true): ChannelInstance {
  return { id, label: id, type, enabled, config: {} }
}

describe('buildContainer telemetry heartbeat wiring', () => {
  it('does not throw when the injected telemetry client rejects (boot never blocks/crashes)', () => {
    const telemetryClient = new FakeTelemetryClient()
    telemetryClient.throwOnSend(new Error('posthog unreachable'))

    expect(() =>
      buildContainer(config, {
        queue: new InMemoryQueue(),
        channelRepo: new FakeChannelRepository(),
        profileRepo: new FakeProfileRepository(),
        http: new FakeHttpClient(),
        mail: new FakeMailTransport(),
        logger: new FakeLogger(),
        telemetryClient
      })
    ).not.toThrow()

    // The rejecting call was still attempted (proves wiring reached it).
    expect(telemetryClient.calls).toHaveLength(1)
  })

  it('sends exactly one heartbeat with deduplicated enabled channel TYPES only', () => {
    const telemetryClient = new FakeTelemetryClient()
    const channelRepo = new FakeChannelRepository([
      instance('acme-slack', 'slack'),
      instance('globex-slack', 'slack'), // same type as above -> deduplicated
      instance('ops-ntfy', 'ntfy'),
      instance('disabled-webhook', 'webhook', false) // disabled -> excluded
    ])

    buildContainer(config, {
      queue: new InMemoryQueue(),
      channelRepo,
      profileRepo: new FakeProfileRepository(),
      http: new FakeHttpClient(),
      mail: new FakeMailTransport(),
      logger: new FakeLogger(),
      telemetryClient
    })

    expect(telemetryClient.calls).toHaveLength(1)
    const [props] = telemetryClient.calls
    expect(props.channelTypesEnabled.slice().sort()).toEqual(['ntfy', 'slack'])
    expect(props.platform).toBe(process.platform)
    expect(typeof props.version).toBe('string')
    expect(props.version.length).toBeGreaterThan(0)
  })

  it('reports an empty channelTypesEnabled array when no channels are enabled', () => {
    const telemetryClient = new FakeTelemetryClient()

    buildContainer(config, {
      queue: new InMemoryQueue(),
      channelRepo: new FakeChannelRepository(),
      profileRepo: new FakeProfileRepository(),
      http: new FakeHttpClient(),
      mail: new FakeMailTransport(),
      logger: new FakeLogger(),
      telemetryClient
    })

    expect(telemetryClient.calls).toHaveLength(1)
    expect(telemetryClient.calls[0]?.channelTypesEnabled).toEqual([])
  })
})
