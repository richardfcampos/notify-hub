/**
 * Tests derive from spec DBCH-05 (delivery read-through / hot-reload):
 * - success loads the instance from the repo AT DELIVERY TIME, builds the
 *   adapter from its current config, sends, and resolves ok:true with the
 *   instance id + elapsed durationMs;
 * - a disabled instance and a deleted/missing instance are logged no-op
 *   skips that RESOLVE (no send, no retry);
 * - HOT-RELOAD: mutating the instance config in the repo between two sends
 *   makes the second send use the NEW config (proven via the FakeHttpClient
 *   URLs), no restart;
 * - a send failure re-throws (so BullMQ retries) and logs the failing result.
 * Uses FakeChannelRepository + a real webhook adapter over FakeHttpClient so
 * the config->URL path is observable; no real network.
 */
import { describe, expect, it } from 'vitest'
import {
  FakeChannelRepository,
  FakeClock,
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../test/helpers/fakes.js'
import type { ChannelDeps, ChannelInstance } from '../core/types.js'
import { DeliveryService } from './delivery-service.js'

function makeChannelDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

const webhookInstance = (over: Partial<ChannelInstance> = {}): ChannelInstance => ({
  id: 'acme-webhook',
  label: 'Acme Webhook',
  type: 'webhook',
  enabled: true,
  config: { WEBHOOK_URL: 'http://acme.test/hook' },
  ...over
})

describe('DeliveryService.deliver', () => {
  it('loads the instance from the repo, sends via its config, and resolves ok:true with the instance id', async () => {
    const http = new FakeHttpClient()
    const clock = new FakeClock(1000)
    const repo = new FakeChannelRepository([webhookInstance()])
    const service = new DeliveryService({
      channelRepo: repo,
      channelDeps: makeChannelDeps(http),
      clock,
      logger: new FakeLogger()
    })

    const result = await service.deliver({
      notification: { title: 't', message: 'hello' },
      channel: 'acme-webhook',
      dispatchJobId: 'd1'
    })

    expect(result.channel).toBe('acme-webhook')
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(1)
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0].url).toBe('http://acme.test/hook')
  })

  it('skips (no send) and warns when the instance is disabled, resolving without retry', async () => {
    const http = new FakeHttpClient()
    const logger = new FakeLogger()
    const repo = new FakeChannelRepository([webhookInstance({ enabled: false })])
    const service = new DeliveryService({
      channelRepo: repo,
      channelDeps: makeChannelDeps(http),
      clock: new FakeClock(),
      logger
    })

    const result = await service.deliver({
      notification: { title: 't', message: 'm' },
      channel: 'acme-webhook',
      dispatchJobId: 'd1'
    })

    expect(result).toEqual({ channel: 'acme-webhook', ok: true, attempts: 0, durationMs: 0 })
    expect(http.calls).toHaveLength(0)
    expect(logger.entries).toHaveLength(1)
    expect(logger.entries[0].level).toBe('warn')
  })

  it('skips (no send) and warns when the instance was deleted/does not exist', async () => {
    const http = new FakeHttpClient()
    const logger = new FakeLogger()
    const repo = new FakeChannelRepository([]) // empty -> get() returns null
    const service = new DeliveryService({
      channelRepo: repo,
      channelDeps: makeChannelDeps(http),
      clock: new FakeClock(),
      logger
    })

    const result = await service.deliver({
      notification: { title: 't', message: 'm' },
      channel: 'ghost',
      dispatchJobId: 'd1'
    })

    expect(result.attempts).toBe(0)
    expect(http.calls).toHaveLength(0)
    expect(logger.entries[0].level).toBe('warn')
  })

  it('hot-reloads: mutating the instance config between sends makes the second send use the new config', async () => {
    const http = new FakeHttpClient()
    const repo = new FakeChannelRepository([webhookInstance()])
    const service = new DeliveryService({
      channelRepo: repo,
      channelDeps: makeChannelDeps(http),
      clock: new FakeClock(),
      logger: new FakeLogger()
    })

    const job = {
      notification: { title: 't', message: 'm' },
      channel: 'acme-webhook',
      dispatchJobId: 'd1'
    }

    await service.deliver(job)

    // Panel edit: same instance id, new webhook URL persisted to the repo.
    repo.upsert(webhookInstance({ config: { WEBHOOK_URL: 'http://acme.test/CHANGED' } }))

    await service.deliver(job)

    expect(http.calls.map((c) => c.url)).toEqual([
      'http://acme.test/hook',
      'http://acme.test/CHANGED'
    ])
  })

  it('re-throws the adapter error (so the queue retries) and logs a failing DeliveryResult first', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 500, body: 'nope' }) // webhook non-2xx -> adapter throws
    const clock = new FakeClock(500)
    const logger = new FakeLogger()
    const repo = new FakeChannelRepository([webhookInstance({ id: 'slacky', type: 'webhook' })])
    const service = new DeliveryService({
      channelRepo: repo,
      channelDeps: makeChannelDeps(http),
      clock,
      logger
    })

    await expect(
      service.deliver({
        notification: { title: 't', message: 'm' },
        channel: 'slacky',
        dispatchJobId: 'd1'
      })
    ).rejects.toThrow(/failed with status 500/)

    const errorEntry = logger.entries.find((e) => e.level === 'error')
    expect(errorEntry).toBeDefined()
    expect((errorEntry?.obj as { channel: string; ok: boolean }).channel).toBe('slacky')
    expect((errorEntry?.obj as { ok: boolean }).ok).toBe(false)
  })
})
