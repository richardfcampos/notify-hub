/**
 * Empty string AND whitespace-only both count as missing, matching the
 * backend's write-time validation rule (config-validation.ts).
 */
import { describe, expect, it } from 'vitest'
import { isChannelConfigComplete, missingRequiredKeys } from './admin-channel-completeness.js'

const requiredConfig = ['SLACK_WEBHOOK_URL']

function channel(config) {
  return { id: 'acme-slack', label: 'Acme Slack', type: 'slack', enabled: true, config }
}

describe('missingRequiredKeys', () => {
  it('returns an empty array when every required key has a value', () => {
    expect(missingRequiredKeys(channel({ SLACK_WEBHOOK_URL: 'https://hooks.example.com' }), requiredConfig)).toEqual([])
  })

  it('returns the missing key when it is absent from config', () => {
    expect(missingRequiredKeys(channel({}), requiredConfig)).toEqual(['SLACK_WEBHOOK_URL'])
  })

  it('treats an empty string as missing', () => {
    expect(missingRequiredKeys(channel({ SLACK_WEBHOOK_URL: '' }), requiredConfig)).toEqual(['SLACK_WEBHOOK_URL'])
  })

  it('treats a whitespace-only value as missing', () => {
    expect(missingRequiredKeys(channel({ SLACK_WEBHOOK_URL: '   ' }), requiredConfig)).toEqual(['SLACK_WEBHOOK_URL'])
  })

  it('reports every missing key for a multi-key type, in order', () => {
    const missing = missingRequiredKeys(channel({}), ['NTFY_URL', 'NTFY_TOPIC'])
    expect(missing).toEqual(['NTFY_URL', 'NTFY_TOPIC'])
  })
})

describe('isChannelConfigComplete', () => {
  it('is true when all required keys are present', () => {
    expect(isChannelConfigComplete(channel({ SLACK_WEBHOOK_URL: 'x' }), requiredConfig)).toBe(true)
  })

  it('is false when a required key is missing', () => {
    expect(isChannelConfigComplete(channel({}), requiredConfig)).toBe(false)
  })

  it('is true for a type with no required keys', () => {
    expect(isChannelConfigComplete(channel({}), [])).toBe(true)
  })
})
