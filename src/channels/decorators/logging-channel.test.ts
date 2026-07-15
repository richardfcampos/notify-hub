/**
 * Tests derive from T4's "Done when": LoggingChannel logs the attempt and
 * its outcome, delegates to the wrapped channel, and never swallows a
 * failing send (re-throws for upstream retry/dead-letter logic).
 */
import { describe, expect, it } from 'vitest'
import type { Notification, NotificationChannel } from '../../core/types.js'
import { FakeLogger } from '../../../test/helpers/fakes.js'
import { LoggingChannel } from './logging-channel.js'

class SucceedingChannel implements NotificationChannel {
  readonly name = 'succeeds'
  readonly received: Notification[] = []

  async send(notification: Notification): Promise<void> {
    this.received.push(notification)
  }
}

class FailingChannel implements NotificationChannel {
  readonly name = 'fails'

  constructor(private readonly error: Error) {}

  async send(): Promise<void> {
    throw this.error
  }
}

describe('LoggingChannel', () => {
  it('delegates to the inner channel and logs the success outcome', async () => {
    const inner = new SucceedingChannel()
    const logger = new FakeLogger()
    const channel = new LoggingChannel(inner, logger)

    await channel.send({ title: 't', message: 'm' })

    expect(inner.received).toEqual([{ title: 't', message: 'm' }])
    expect(logger.entries.some((e) => e.level === 'info')).toBe(true)
  })

  it('re-throws the inner error and logs it (never swallows a failure)', async () => {
    const error = new Error('channel down')
    const inner = new FailingChannel(error)
    const logger = new FakeLogger()
    const channel = new LoggingChannel(inner, logger)

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('channel down')
    expect(logger.entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('delegates the inner channel name', () => {
    const inner = new SucceedingChannel()
    const logger = new FakeLogger()
    const channel = new LoggingChannel(inner, logger)

    expect(channel.name).toBe('succeeds')
  })
})
