/**
 * Generic webhook channel adapter (spec NOTIF-16, P3): the reference
 * extensibility example. POSTs the full Notification as JSON to a
 * configured URL -- no channel-specific reshaping, so any downstream
 * consumer (Gotify, a custom listener, etc.) gets the raw payload. Depends
 * only on the injected HttpClient (never imports fetch directly) so it
 * stays mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class WebhookChannel implements NotificationChannel {
  readonly name = 'webhook'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const url = this.cfg.WEBHOOK_URL
    const response = await this.deps.http.request({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      body: {
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        tags: notification.tags,
        metadata: notification.metadata
      }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `webhook channel: request to ${url} failed with status ${response.status}`
      )
    }
  }
}

export const webhookRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new WebhookChannel(cfg, deps),
  requiredConfig: ['WEBHOOK_URL']
}
