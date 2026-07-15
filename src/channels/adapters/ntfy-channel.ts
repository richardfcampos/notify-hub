/**
 * ntfy channel adapter (spec NOTIF-05). Publishes to a self-hosted or
 * ntfy.sh topic via HTTP POST -- title/priority/tags map to ntfy's header
 * conventions, the message is the plain-text body. Depends only on the
 * injected HttpClient (never imports fetch directly) so it stays
 * mockable.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class NtfyChannel implements NotificationChannel {
  readonly name = 'ntfy'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const headers: Record<string, string> = {
      Title: notification.title
    }
    if (notification.priority) {
      headers.Priority = notification.priority
    }
    if (notification.tags && notification.tags.length > 0) {
      headers.Tags = notification.tags.join(',')
    }

    const url = `${this.cfg.NTFY_URL}/${this.cfg.NTFY_TOPIC}`
    const response = await this.deps.http.request({
      method: 'POST',
      url,
      headers,
      body: notification.message
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
