/**
 * ntfy channel adapter. Publishes to a self-hosted or ntfy.sh topic using
 * ntfy's JSON publish format: POST to the server root with the topic in
 * the body. JSON keeps every field UTF-8 safe -- title/tags/message may
 * contain emoji or accents, which would break ntfy's alternative
 * header-based convention (HTTP headers only allow Latin-1). Depends only
 * on the injected HttpClient (never imports fetch directly) so it stays
 * mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

/** ntfy priorities are integers 1 (min) .. 5 (max). */
const NTFY_PRIORITY: Record<string, number> = {
  low: 2,
  default: 3,
  high: 4,
  urgent: 5
}

export class NtfyChannel implements NotificationChannel {
  readonly name = 'ntfy'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const body: Record<string, unknown> = {
      topic: this.cfg.NTFY_TOPIC,
      title: notification.title,
      message: notification.message
    }
    if (notification.priority) {
      body.priority = NTFY_PRIORITY[notification.priority]
    }
    if (notification.tags && notification.tags.length > 0) {
      body.tags = notification.tags
    }

    const url = this.cfg.NTFY_URL
    const response = await this.deps.http.request({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      body
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `ntfy channel: request to ${url} failed with status ${response.status}`
      )
    }
  }
}

export const ntfyRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new NtfyChannel(cfg, deps),
  requiredConfig: ['NTFY_URL', 'NTFY_TOPIC']
}
