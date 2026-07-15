/**
 * WhatsApp channel adapter via CallMeBot. Sends a GET request to
 * CallMeBot's whatsapp.php endpoint with phone/text/apikey as urlencoded
 * query params (matches CallMeBot's own documented example:
 * `?phone=...&text=...&apikey=...`, spaces as `+`). Depends only on the
 * injected HttpClient (never imports fetch directly) so it stays mockable.
 *
 * CallMeBot reports failures (invalid apikey, bad phone format) with a
 * 2xx status and the error text in the response body -- observed live:
 * 203 "APIKey is invalid", 201 "ERROR: Phone number format is incorrect".
 * Success is therefore confirmed by the "Message queued" body marker, not
 * by the status code alone. Error snippets are sanitized (phone/apikey
 * redacted, HTML stripped) because CallMeBot echoes them in the body.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  Notification,
  NotificationChannel
} from '../../core/types.js'

const CALLMEBOT_URL = 'https://api.callmebot.com/whatsapp.php'

export class WhatsAppChannel implements NotificationChannel {
  readonly name = 'whatsapp'

  constructor(
    private readonly cfg: Record<string, string>,
    private readonly deps: ChannelDeps
  ) {}

  async send(notification: Notification): Promise<void> {
    const params = new URLSearchParams({
      phone: this.cfg.WHATSAPP_PHONE,
      text: `${notification.title}\n${notification.message}`,
      apikey: this.cfg.WHATSAPP_APIKEY
    })
    const url = `${CALLMEBOT_URL}?${params.toString()}`

    const response = await this.deps.http.request({ method: 'GET', url })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `whatsapp channel: request to ${CALLMEBOT_URL} failed with status ${response.status}`
      )
    }

    if (!/message queued/i.test(response.body)) {
      throw new Error(
        `whatsapp channel: CallMeBot reported an error (status ${response.status}): ${this.sanitize(response.body)}`
      )
    }
  }

  /** Strip HTML and redact the configured phone/apikey from body snippets. */
  private sanitize(body: string): string {
    let text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    for (const secret of [this.cfg.WHATSAPP_PHONE, this.cfg.WHATSAPP_APIKEY]) {
      if (secret) {
        text = text.split(secret).join('<redacted>')
      }
    }
    return text.slice(0, 160)
  }
}

export const whatsappRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new WhatsAppChannel(cfg, deps),
  requiredConfig: ['WHATSAPP_PHONE', 'WHATSAPP_APIKEY'],
  maxLength: 1000
}
