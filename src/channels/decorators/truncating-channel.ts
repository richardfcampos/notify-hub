/**
 * Decorator: truncates Notification.message to a configured character
 * limit before delegating to the wrapped channel (spec AC NOTIF-05.6 --
 * adapters must truncate to fit rather than error). Messages within the
 * limit pass through unchanged.
 */
import type { Notification, NotificationChannel } from '../../core/types.js'

export class TruncatingChannel implements NotificationChannel {
  readonly name: string

  constructor(
    private readonly inner: NotificationChannel,
    private readonly limit: number
  ) {
    this.name = inner.name
  }

  async send(notification: Notification): Promise<void> {
    if (notification.message.length <= this.limit) {
      return this.inner.send(notification)
    }

    // Reserve one char for the ellipsis so the final message length == limit.
    const truncated = `${notification.message.slice(0, this.limit - 1)}…`
    return this.inner.send({ ...notification, message: truncated })
  }
}
