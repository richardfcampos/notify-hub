/**
 * Local TTS (macOS `say`) channel adapter (spec LTTS-02). POSTs to the
 * companion `clients/local-tts-player` HTTP service running on the host
 * (outside Docker -- Docker Desktop for Mac has no CoreAudio access from
 * inside a container), which speaks the notification aloud via `say`.
 * Depends only on the injected HttpClient (never imports fetch directly)
 * so it stays mockable, same pattern as every other webhook-style adapter.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

export class LocalTtsChannel implements NotificationChannel {
  readonly name = 'local-tts'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const text = notification.title
      ? `${notification.title}. ${notification.message}`
      : notification.message

    const response = await this.deps.http.request({
      method: 'POST',
      url: `${this.cfg.LOCAL_TTS_URL}/speak`,
      headers: { 'content-type': 'application/json' },
      body: { voice: this.cfg.LOCAL_TTS_VOICE, text }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `local-tts channel: player request failed with status ${response.status}`
      )
    }
  }
}

export const localTtsRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new LocalTtsChannel(cfg, deps),
  requiredConfig: ['LOCAL_TTS_URL', 'LOCAL_TTS_VOICE']
}
