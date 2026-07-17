/**
 * Voice Monkey (Alexa) channel adapter. Voice Monkey is a third-party
 * service that triggers an Echo device to speak arbitrary text -- the
 * practical Alexa integration since the official Amazon Proactive Events
 * API only supports 8 fixed light/banner schemas, no verbatim speech
 * (researched separately, see .specs/features/voicemonkey-channel/spec.md).
 *
 * API verified live against Voice Monkey's current (v3) docs:
 * https://voicemonkey.io/docs/api/announcement and
 * https://voicemonkey.io/docs/api/authentication (2026-07-17). Contract:
 *   POST https://api-v3.voicemonkey.io/announce
 *   JSON body: { token, device, speech }  (token + device required, all
 *   three accepted as documented "Core" params; announcement-only use
 *   needs nothing else)
 *   Success: HTTP 200, body {"success":true,"data":"OK"}
 *   Errors: a REAL non-2xx status (400/401/404/429/500) with a JSON body
 *   `{"error":"CODE"}` (sometimes plus extra context, e.g.
 *   `{"error":"THROTTLED","lockoutUntil":"<ISO>"}`).
 *
 * Unlike CallMeBot (the WhatsApp provider in this project), Voice Monkey
 * does NOT hide failures behind a 2xx status -- every documented failure
 * mode uses a proper non-2xx code, so no "2xx-lies" body-marker check is
 * needed here. We still parse the JSON error body for a friendlier message
 * and sanitize any raw fallback text (never echo the configured
 * token/device), purely as defense-in-depth against an undocumented
 * response shape -- Voice Monkey's docs do not show the token/device being
 * echoed back in error bodies.
 *
 * No documented character limit for `speech` was found (the docs only
 * suggest breaking long text into multiple sentences for TTS reliability),
 * so -- consistent with the project's other uncapped adapters (webhook,
 * slack) -- `maxLength` is intentionally omitted from the registry entry.
 *
 * Depends only on the injected HttpClient (never imports fetch directly)
 * so it stays mockable, mirroring every other adapter.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

const VOICEMONKEY_ANNOUNCE_URL = 'https://api-v3.voicemonkey.io/announce'

export class VoiceMonkeyChannel implements NotificationChannel {
  readonly name = 'voicemonkey'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const speech = `${notification.title}. ${notification.message}`

    const response = await this.deps.http.request({
      method: 'POST',
      url: VOICEMONKEY_ANNOUNCE_URL,
      headers: { 'content-type': 'application/json' },
      body: {
        token: this.cfg.VOICEMONKEY_TOKEN,
        device: this.cfg.VOICEMONKEY_DEVICE,
        speech
      }
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `voicemonkey channel: announce request failed with status ${response.status}: ${this.describeError(response.body)}`
      )
    }
  }

  /**
   * Voice Monkey's documented error body is `{"error":"CODE"}`, optionally
   * with extra context fields (e.g. lockoutUntil, periodEnd). Falls back
   * to a sanitized raw-body snippet if the body isn't that shape.
   */
  private describeError(body: string): string {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      if (typeof parsed.error === 'string') {
        const extra = Object.entries(parsed)
          .filter(([key]) => key !== 'error')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
        return extra ? `${parsed.error} (${extra})` : parsed.error
      }
    } catch {
      // Not the documented JSON error shape -- fall through to sanitized raw body.
    }
    return this.sanitize(body)
  }

  /** Strip whitespace runs and redact the configured token/device from body snippets. */
  private sanitize(body: string): string {
    let text = body.replace(/\s+/g, ' ').trim()
    for (const secret of [this.cfg.VOICEMONKEY_TOKEN, this.cfg.VOICEMONKEY_DEVICE]) {
      if (secret) {
        text = text.split(secret).join('<redacted>')
      }
    }
    return text.slice(0, 160)
  }
}

export const voicemonkeyRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new VoiceMonkeyChannel(cfg, deps),
  requiredConfig: ['VOICEMONKEY_TOKEN', 'VOICEMONKEY_DEVICE']
}
