/**
 * Email channel adapter (spec NOTIF-07). Delegates the actual SMTP send
 * to an injected MailTransport -- never imports nodemailer directly (that
 * lives in transports/nodemailer-transport.ts) so this stays mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class EmailChannel implements NotificationChannel {
  readonly name = 'email'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    await this.deps.mail.send({
      to: this.cfg.EMAIL_TO,
      subject: notification.title,
      text: notification.message
    })
  }
}

export const emailRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new EmailChannel(cfg, deps),
  requiredConfig: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_TO']
}
