/**
 * Tests derive from spec AC NOTIF-05.6 ("truncate to fit rather than
 * error") and T4's "Done when": TruncatingChannel truncates to the
 * configured limit then delegates; messages within the limit pass
 * through unchanged; the wrapped channel's name is delegated.
 */
import { describe, expect, it } from 'vitest'
import type { Notification, NotificationChannel } from '../../core/types.js'
import { TruncatingChannel } from './truncating-channel.js'

class RecordingChannel implements NotificationChannel {
  readonly name = 'recording'
  readonly received: Notification[] = []

  async send(notification: Notification): Promise<void> {
    this.received.push(notification)
  }
}

describe('TruncatingChannel', () => {
  it('passes the message through unchanged when within the limit', async () => {
    const inner = new RecordingChannel()
    const channel = new TruncatingChannel(inner, 10)

    await channel.send({ title: 't', message: 'short' })

    expect(inner.received).toEqual([{ title: 't', message: 'short' }])
  })

  it('truncates to the configured limit and appends an ellipsis before delegating', async () => {
    const inner = new RecordingChannel()
    const channel = new TruncatingChannel(inner, 10)

    await channel.send({
      title: 't',
      message: 'this message is far too long to fit'
    })

    expect(inner.received).toHaveLength(1)
    const delivered = inner.received[0]
    expect(delivered.message).toHaveLength(10)
    expect(delivered.message.endsWith('…')).toBe(true)
    expect(delivered.title).toBe('t')
  })

  it('delegates the inner channel name', () => {
    const inner = new RecordingChannel()
    const channel = new TruncatingChannel(inner, 10)

    expect(channel.name).toBe('recording')
  })
})
