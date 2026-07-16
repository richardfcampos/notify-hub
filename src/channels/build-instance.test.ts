/**
 * Tests derive from spec AC DBCH-04 (type-keyed registry + per-instance
 * build): a happy build wraps the adapter so BOTH decorators actually apply
 * (message truncated at the type's maxLength; every send logged under the
 * INSTANCE id, not the type); an instance whose type has no registry entry
 * throws naming the type + the instance. Uses a stub registry so no real
 * adapter/config is needed.
 */
import { describe, expect, it } from 'vitest'
import type {
  ChannelDeps,
  ChannelInstance,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../test/helpers/fakes.js'
import { buildInstance } from './build-instance.js'

class StubChannel implements NotificationChannel {
  // `.name` is the TYPE, mirroring every real adapter -- the builder must
  // override the log label with the instance id, not reuse this.
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

const instance = (over: Partial<ChannelInstance> = {}): ChannelInstance => ({
  id: 'acme-slack',
  label: 'Acme Slack',
  type: 'stub',
  enabled: true,
  config: {},
  ...over
})

describe('buildInstance', () => {
  it('throws naming the type and the instance when the type has no registry entry', () => {
    expect(() =>
      buildInstance(instance({ type: 'carrier-pigeon', id: 'weird-one' }), makeDeps(), {})
    ).toThrowError(/carrier-pigeon/)
    expect(() =>
      buildInstance(instance({ type: 'carrier-pigeon', id: 'weird-one' }), makeDeps(), {})
    ).toThrowError(/weird-one/)
  })

  it('builds the adapter from the instance config and truncates at the type maxLength', async () => {
    const stub = new StubChannel()
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => stub, requiredConfig: [], maxLength: 5 }
    }

    const channel = buildInstance(instance(), makeDeps(), registry)
    await channel.send({ title: 't', message: 'way too long for five' })

    expect(stub.received).toHaveLength(1)
    expect(stub.received[0].message).toHaveLength(5)
  })

  it('does not truncate when the registry entry omits maxLength', async () => {
    const stub = new StubChannel()
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => stub, requiredConfig: [] }
    }
    const longMessage = 'x'.repeat(10000)

    const channel = buildInstance(instance(), makeDeps(), registry)
    await channel.send({ title: 't', message: longMessage })

    expect(stub.received[0].message).toBe(longMessage)
  })

  it('logs every send under the INSTANCE id, not the channel type', async () => {
    const stub = new StubChannel()
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: { factory: () => stub, requiredConfig: [] }
    }
    const deps = makeDeps()

    const channel = buildInstance(instance({ id: 'globex-slack' }), deps, registry)
    // The log label is the instance id, so a wrapped channel exposes it as .name.
    expect(channel.name).toBe('globex-slack')

    await channel.send({ title: 't', message: 'm' })

    const logger = deps.logger as FakeLogger
    expect(logger.entries.length).toBeGreaterThan(0)
    expect(
      logger.entries.every(
        (e) => (e.obj as { channel?: string }).channel === 'globex-slack'
      )
    ).toBe(true)
  })

  it('passes the instance config through to the adapter factory', () => {
    let seenCfg: Record<string, string> | null = null
    const registry: Record<string, ChannelRegistryEntry> = {
      stub: {
        factory: (cfg) => {
          seenCfg = cfg
          return new StubChannel()
        },
        requiredConfig: []
      }
    }

    buildInstance(instance({ config: { SLACK_WEBHOOK_URL: 'http://a.test' } }), makeDeps(), registry)

    expect(seenCfg).toEqual({ SLACK_WEBHOOK_URL: 'http://a.test' })
  })
})
