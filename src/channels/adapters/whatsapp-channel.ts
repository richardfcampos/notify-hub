/**
 * WhatsApp channel adapter via CallMeBot (spec NOTIF-15, P2). Sends a GET
 * request to CallMeBot's whatsapp.php endpoint with phone/text/apikey as
 * urlencoded query params (matches CallMeBot's own documented example:
 * `?phone=...&text=...&apikey=...`, spaces as `+`). Depends only on the
 * injected HttpClient (never imports fetch directly) so it stays mockable.
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
  }
}

export const whatsappRegistryEntry: ChannelRegistryEntry = {
  factory: (cfg, deps) => new WhatsAppChannel(cfg, deps),
  requiredConfig: ['WHATSAPP_PHONE', 'WHATSAPP_APIKEY'],
  maxLength: 1000
}
