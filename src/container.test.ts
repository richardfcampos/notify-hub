/**
 * Boot-wiring tests for the telemetry heartbeat (spec TEL-03, Edge Cases):
 * a rejecting telemetry client must never crash/block container wiring
 * (Edge Cases: "MUST NOT crash or delay api/worker boot"), and the
 * heartbeat fires exactly once per buildContainer() call carrying the
 * deduplicated enabled channel TYPES only (never instance ids/labels).
 * Everything else is injected (InMemoryQueue, fake repos/http/mail/logger)
 * so this never touches SQLite/Redis/SMTP/PostHog.
 *
 * `sendHeartbeat` is fire-and-forget in container.ts: the rejection from a
 * failing telemetry client resolves asynchronously (a microtask/macrotask
 * after buildContainer() returns), so a synchronous `.not.toThrow()` alone
 * cannot observe whether container.ts's `.catch(() => {})` swallow is still
 * in place -- it would pass even if that swallow were removed. The first
 * test below additionally installs a scoped `unhandledRejection` listener
 * and flushes the event loop past the current macrotask, so removing the
 * `.catch()` in container.ts makes this test fail for real.
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
  it('does not throw when the injected telemetry client rejects (boot never blocks/crashes)', async () => {
    const telemetryClient = new FakeTelemetryClient()
    telemetryClient.throwOnSend(new Error('posthog unreachable'))

    // Scoped listener: proves the fire-and-forget sendHeartbeat rejection is
    // actually swallowed by container.ts's `.catch()`, not merely that
    // buildContainer() itself never throws synchronously (which is true
    // regardless of whether that `.catch()` exists, since sendHeartbeat's
    // rejection only surfaces asynchronously).
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    try {
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

      // Flush past the current macrotask so the fire-and-forget promise's
      // rejection (and container.ts's `.catch()` on it) has had a chance to
      // run before we inspect whether it went unhandled.
      await new Promise((resolve) => setImmediate(resolve))

      // The rejecting call was still attempted (proves wiring reached it).
      expect(telemetryClient.calls).toHaveLength(1)
      expect(unhandledRejections).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
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
