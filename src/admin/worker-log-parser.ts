/**
 * Parses `docker compose logs worker` output into per-channel delivery
 * outcomes (ADMIN-06). Each pino line (prefixed by docker compose's
 * `<service> | ` container tag) is a JSON object; only the two messages
 * that represent an authoritative, one-per-attempt outcome are kept:
 * - `channels/decorators/logging-channel.ts` logs "notification sent" on
 *   success (no separate delivery-service line follows for that case).
 * - `delivery/delivery-service.ts` logs `delivery failed for channel "X"`
 *   on failure (delivery-service also logs, so this is the single
 *   authoritative failure line even though logging-channel also logged a
 *   "notification send failed" line for the same attempt -- that one is
 *   intentionally NOT matched, to avoid double-counting one failure as
 *   two events).
 */

export interface WorkerDeliveryEvent {
  channel: string
  ok: boolean
  error?: string
  /** ISO-8601, derived from pino's `time` (epoch ms), when present. */
  time?: string
}

const SENT_MSG = 'notification sent'
const FAILED_MSG_PREFIX = 'delivery failed for channel'
/** ADMIN-06.1: "the last ~20 worker delivery log lines". */
const MAX_EVENTS = 20

function extractJsonObject(line: string): Record<string, unknown> | null {
  const start = line.indexOf('{')
  if (start === -1) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(line.slice(start))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function toIsoTime(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : undefined
}

/** Non-JSON lines (docker banners, container startup noise) are silently skipped. */
export function parseWorkerDeliveryLogs(raw: string): WorkerDeliveryEvent[] {
  const events: WorkerDeliveryEvent[] = []

  for (const line of raw.split('\n')) {
    const obj = extractJsonObject(line)
    if (!obj || typeof obj.msg !== 'string' || typeof obj.channel !== 'string') {
      continue
    }

    if (obj.msg === SENT_MSG) {
      events.push({ channel: obj.channel, ok: true, time: toIsoTime(obj.time) })
    } else if (obj.msg.startsWith(FAILED_MSG_PREFIX)) {
      events.push({
        channel: obj.channel,
        ok: false,
        error: typeof obj.error === 'string' ? obj.error : undefined,
        time: toIsoTime(obj.time)
      })
    }
  }

  return events.slice(-MAX_EVENTS)
}
