/**
 * Tests derive from spec AC NOTIF-10 (fail-fast validation) and T4's
 * "Done when": unknown channel name throws; missing/empty required
 * config throws naming the key; a happy-path build wraps the channel so
 * both decorators (truncation, logging) actually apply.
 */
import { describe, expect, it } from 'vitest'
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../test/helpers/fakes.js'
import { ChannelBuilder } from './channel-builder.js'

class StubChannel implements NotificationChannel {
  readonly name = 'stub'
  readonly received: Notification[] = []

  async send(notification: Notification): Promise<void> {
    this.received.push(notification)
  }
}

function makeDeps(): ChannelDeps {
  return {
    http: new FakeHttpClient(),
    mail: new FakeMailTransport(),
    logger: new FakeLogger()
  }
}

describe('ChannelBuilder.buildActive', () => {
  it('throws naming the channel when an enabled name has no registry entry', () => {
    const registry: Record<string, ChannelRegistryEntry> = {}

    expect(() =>
      ChannelBuilder.buildActive(registry, ['carrier-pigeon'], {}, makeDeps())
    ).toThrowError(/carrier-pigeon/)
  })

  it('throws naming the channel and the missing key when required config is absent', () => {
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => new StubChannel(), requiredConfig: ['STUB_KEY'] }
    }

    expect(() =>
      ChannelBuilder.buildActive(registry, ['stub'], {}, makeDeps())
    ).toThrowError(/stub/i)
    expect(() =>
      ChannelBuilder.buildActive(registry, ['stub'], {}, makeDeps())
    ).toThrowError(/STUB_KEY/)
  })

  it('throws when a required key is present but empty/whitespace', () => {
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => new StubChannel(), requiredConfig: ['STUB_KEY'] }
    }

    expect(() =>
      ChannelBuilder.buildActive(
        registry,
        ['stub'],
        { stub: { STUB_KEY: '   ' } },
        makeDeps()
      )
    ).toThrowError(/STUB_KEY/)
  })

  it('builds a channel per enabled name, truncated at the registry maxLength', async () => {
    const stub = new StubChannel()
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => stub, requiredConfig: [], maxLength: 5 }
    }
    const deps = makeDeps()

    const built = ChannelBuilder.buildActive(registry, ['stub'], {}, deps)
    const channel = built.get('stub')

    expect(built.size).toBe(1)
    expect(channel?.name).toBe('stub')

    await channel!.send({ title: 't', message: 'way too long for five' })

    expect(stub.received).toHaveLength(1)
    expect(stub.received[0].message).toHaveLength(5)
  })

  it('defaults maxLength to Infinity (no truncation) when the registry entry omits it', async () => {
    const stub = new StubChannel()
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => stub, requiredConfig: [] }
    }
    const deps = makeDeps()
    const longMessage = 'x'.repeat(10000)

    const channel = ChannelBuilder.buildActive(registry, ['stub'], {}, deps).get(
      'stub'
    )!
    await channel.send({ title: 't', message: longMessage })

    expect(stub.received[0].message).toBe(longMessage)
  })

  it('wraps with LoggingChannel so every send is logged', async () => {
    const stub = new StubChannel()
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => stub, requiredConfig: [] }
    }
    const deps = makeDeps()

    const channel = ChannelBuilder.buildActive(registry, ['stub'], {}, deps).get(
      'stub'
    )!
    await channel.send({ title: 't', message: 'm' })

    expect((deps.logger as FakeLogger).entries.length).toBeGreaterThan(0)
  })
})
