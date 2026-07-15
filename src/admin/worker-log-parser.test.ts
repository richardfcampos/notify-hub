/**
 * Tests derive from spec ADMIN-06 (status shows recent worker deliveries).
 * Crafts realistic docker-compose-prefixed pino JSON lines matching the
 * exact shapes emitted by logging-channel.ts ("notification sent") and
 * delivery-service.ts (`delivery failed for channel "X"`).
 */
import { describe, expect, it } from 'vitest'
import { parseWorkerDeliveryLogs } from './worker-log-parser.js'

function pinoLine(obj: Record<string, unknown>): string {
  return `worker-1  | ${JSON.stringify({ level: 30, pid: 1, hostname: 'h', ...obj })}`
}

describe('parseWorkerDeliveryLogs', () => {
  it('extracts a sent event from a "notification sent" line', () => {
    const raw = pinoLine({ time: 1700000000000, channel: 'ntfy', msg: 'notification sent' })

    expect(parseWorkerDeliveryLogs(raw)).toEqual([
      { channel: 'ntfy', ok: true, time: new Date(1700000000000).toISOString() }
    ])
  })

  it('extracts a failure event (with error) from a "delivery failed for channel" line', () => {
    const raw = pinoLine({
      time: 1700000001000,
      channel: 'slack',
      ok: false,
      error: 'invalid_payload',
      attempts: 1,
      durationMs: 12,
      msg: 'delivery failed for channel "slack"'
    })

    expect(parseWorkerDeliveryLogs(raw)).toEqual([
      { channel: 'slack', ok: false, error: 'invalid_payload', time: new Date(1700000001000).toISOString() }
    ])
  })

  it('ignores unrelated log lines ("sending notification", "notification send failed", non-JSON banners)', () => {
    const raw = [
      'worker started; processing dispatch + delivery jobs',
      pinoLine({ time: 1, channel: 'ntfy', msg: 'sending notification' }),
      pinoLine({ time: 2, channel: 'slack', error: 'x', msg: 'notification send failed' }),
      pinoLine({ time: 3, channel: 'ntfy', msg: 'notification sent' })
    ].join('\n')

    expect(parseWorkerDeliveryLogs(raw)).toEqual([
      { channel: 'ntfy', ok: true, time: new Date(3).toISOString() }
    ])
  })

  it('keeps only the last 20 events (ADMIN-06.1)', () => {
    const lines = Array.from({ length: 25 }, (_, i) =>
      pinoLine({ time: i, channel: 'ntfy', msg: 'notification sent' })
    )

    const events = parseWorkerDeliveryLogs(lines.join('\n'))

    expect(events).toHaveLength(20)
    expect(events[0].time).toBe(new Date(5).toISOString())
    expect(events[19].time).toBe(new Date(24).toISOString())
  })

  it('returns an empty array for empty/garbage input', () => {
    expect(parseWorkerDeliveryLogs('')).toEqual([])
    expect(parseWorkerDeliveryLogs('not json at all\n{broken')).toEqual([])
  })
})
