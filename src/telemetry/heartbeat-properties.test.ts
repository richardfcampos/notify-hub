/**
 * Exact-shape test for the PostHog payload (spec TEL-01 AC3, Edge Cases:
 * empty channelTypesEnabled proves absence rather than omitting the field).
 * Asserts the object has EXACTLY these keys -- no extra field can ever leak
 * in silently.
 */
import { describe, expect, it } from 'vitest'
import { buildHeartbeatProperties } from './heartbeat-properties.js'

describe('buildHeartbeatProperties', () => {
  it('returns the exact documented shape including $process_person_profile: false', () => {
    const payload = buildHeartbeatProperties({
      version: '1.2.3',
      channelTypesEnabled: ['ntfy', 'slack'],
      platform: 'linux'
    })

    expect(payload).toEqual({
      version: '1.2.3',
      channelTypesEnabled: ['ntfy', 'slack'],
      platform: 'linux',
      $process_person_profile: false
    })
    expect(Object.keys(payload).sort()).toEqual(
      ['$process_person_profile', 'channelTypesEnabled', 'platform', 'version'].sort()
    )
  })

  it('keeps an empty channelTypesEnabled as [] rather than omitting/nulling it', () => {
    const payload = buildHeartbeatProperties({
      version: '1.2.3',
      channelTypesEnabled: [],
      platform: 'darwin'
    })

    expect(payload.channelTypesEnabled).toEqual([])
  })

  it('does not mutate the caller-provided array (defensive copy)', () => {
    const source = ['ntfy']
    const payload = buildHeartbeatProperties({ version: '1.0.0', channelTypesEnabled: source, platform: 'linux' })

    payload.channelTypesEnabled.push('slack')

    expect(source).toEqual(['ntfy'])
  })
})
