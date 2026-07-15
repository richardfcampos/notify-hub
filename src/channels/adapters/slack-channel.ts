/**
 * Slack channel adapter (spec NOTIF-08). POSTs to a configured incoming
 * webhook URL. Depends only on the injected HttpClient (never imports
 * fetch directly) so it stays mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class SlackChannel implements NotificationChannel {
  readonly name = 'slack'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const response = await this.deps.http.request({
      method: 'POST',
      url: this.cfg.SLACK_WEBHOOK_URL,
      headers: { 'content-type': 'application/json' },
      body: { text: `*${notification.title}*\n${notification.message}` }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `slack channel: webhook request failed with status ${response.status}`
      )
    }
  }
}

export const slackRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new SlackChannel(cfg, deps),
  requiredConfig: ['SLACK_WEBHOOK_URL']
}
