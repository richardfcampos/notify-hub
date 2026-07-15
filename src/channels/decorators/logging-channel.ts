/**
 * Decorator: logs each send attempt and its outcome, then delegates.
 * Never swallows a failure -- always re-throws so retry/dead-letter logic
 * upstream still observes it.
 */
import type { Notification, NotificationChannel } from '../../core/types.js'
import type { Logger } from '../../core/ports.js'

export class LoggingChannel implements NotificationChannel {
  readonly name: string

  constructor(
    private readonly inner: NotificationChannel,
    private readonly logger: Logger
  ) {
    this.name = inner.name
  }

  async send(notification: Notification): Promise<void> {
    this.logger.info({ channel: this.name }, 'sending notification')
    try {
      await this.inner.send(notification)
      this.logger.info({ channel: this.name }, 'notification sent')
    } catch (error) {
      this.logger.error(
        {
          channel: this.name,
          error: error instanceof Error ? error.message : String(error)
        },
        'notification send failed'
      )
      throw error
    }
  }
}
