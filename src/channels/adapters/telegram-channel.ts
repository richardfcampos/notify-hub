/**
 * Telegram channel adapter (spec NOTIF-06). Sends via the Bot API's
 * sendMessage endpoint. Depends only on the injected HttpClient (never
 * imports fetch directly) so it stays mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class TelegramChannel implements NotificationChannel {
  readonly name = 'telegram'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const url = `https://api.telegram.org/bot${this.cfg.TELEGRAM_BOT_TOKEN}/sendMessage`
    const response = await this.deps.http.request({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      body: {
        chat_id: this.cfg.TELEGRAM_CHAT_ID,
        text: `${notification.title}\n${notification.message}`
      }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `telegram channel: sendMessage request failed with status ${response.status}`
      )
    }
  }
}

export const telegramRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new TelegramChannel(cfg, deps),
  requiredConfig: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
  maxLength: 4096
}
