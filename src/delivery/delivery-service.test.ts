/**
 * Tests derive from spec NOTIF-02/NOTIF-04 and T12's Done-when: success
 * resolves a DeliveryResult and calls channel.send with the exact
 * notification; a channel throw re-throws (so BullMQ retries) and the
 * error surfaces in the logged DeliveryResult; an unknown channel throws;
 * durationMs is deterministic via FakeClock.
 */
import { describe, expect, it } from 'vitest'
import { FakeClock, FakeLogger } from '../../test/helpers/fakes.js'
import type { Notification, NotificationChannel } from '../core/types.js'
import { DeliveryService } from './delivery-service.js'

/** Minimal NotificationChannel test double; optionally advances the shared
 * FakeClock inside send() so durationMs is deterministic, and optionally
 * throws to simulate a channel failure. */
class FakeChannel implements NotificationChannel {
  readonly calls: Notification[] = []
  private error: Error | null = null

  constructor(
    readonly name: string,
    private readonly clock?: FakeClock,
    private readonly elapsedMs = 0
  ) {}

  throwOnSend(error: Error): void {
    this.error = error
  }

  async send(notification: Notification): Promise<void> {
    this.calls.push(notification)
    this.clock?.advance(this.elapsedMs)
    if (this.error) {
      throw this.error
    }
  }
}

describe('DeliveryService.deliver', () => {
  it('sends via the looked-up channel and resolves ok:true with the elapsed durationMs', async () => {
    const clock = new FakeClock(1000)
    const channel = new FakeChannel('ntfy', clock, 42)
    const logger = new FakeLogger()
    const service = new DeliveryService({
      channels: new Map([['ntfy', channel]]),
      clock,
      logger
    })

    const notification: Notification = { title: 't', message: 'hello' }
    const result = await service.deliver({
      notification,
      channel: 'ntfy',
      dispatchJobId: 'd1'
    })

    expect(channel.calls).toEqual([notification])
    expect(result).toEqual({
      channel: 'ntfy',
      ok: true,
      attempts: 1,
      durationMs: 42
    })
  })

  it('throws for a channel that is not in the active map', async () => {
    const clock = new FakeClock()
    const service = new DeliveryService({
      channels: new Map(),
      clock,
      logger: new FakeLogger()
    })

    await expect(
      service.deliver({
        notification: { title: 't', message: 'm' },
        channel: 'ntfy',
        dispatchJobId: 'd1'
      })
    ).rejects.toThrow(/ntfy/i)
  })

  it('re-throws the channel error (so the queue retries) and logs a failing DeliveryResult first', async () => {
    const clock = new FakeClock(500)
    const channel = new FakeChannel('slack', clock, 10)
    channel.throwOnSend(new Error('webhook unreachable'))
    const logger = new FakeLogger()
    const service = new DeliveryService({
      channels: new Map([['slack', channel]]),
      clock,
      logger
    })

    await expect(
      service.deliver({
        notification: { title: 't', message: 'm' },
        channel: 'slack',
        dispatchJobId: 'd1'
      })
    ).rejects.toThrow('webhook unreachable')

    expect(logger.entries).toHaveLength(1)
    expect(logger.entries[0].level).toBe('error')
    expect(logger.entries[0].obj).toEqual({
      channel: 'slack',
      ok: false,
      error: 'webhook unreachable',
      attempts: 1,
      durationMs: 10
    })
  })
})
