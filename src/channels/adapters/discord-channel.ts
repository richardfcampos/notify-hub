/**
 * Discord channel adapter (spec NOTIF-09). POSTs to a configured
 * incoming webhook URL. Depends only on the injected HttpClient (never
 * imports fetch directly) so it stays mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class DiscordChannel implements NotificationChannel {
  readonly name = 'discord'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const response = await this.deps.http.request({
      method: 'POST',
      url: this.cfg.DISCORD_WEBHOOK_URL,
      headers: { 'content-type': 'application/json' },
      body: { content: `**${notification.title}**\n${notification.message}` }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `discord channel: webhook request failed with status ${response.status}`
      )
    }
  }
}

export const discordRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new DiscordChannel(cfg, deps),
  requiredConfig: ['DISCORD_WEBHOOK_URL'],
  maxLength: 2000
}
