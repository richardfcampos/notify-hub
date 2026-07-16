/**
 * slugify must produce ids that isValidChannelId always accepts (so the
 * Add-channel form's live suggestion never contradicts its own validation),
 * and isValidChannelId must mirror the backend's CHANNEL_ID_SLUG_RE exactly.
 */
import { describe, expect, it } from 'vitest'
import { isValidChannelId, slugify } from './admin-instance-id.js'

describe('slugify', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(slugify('Acme Slack')).toBe('acme-slack')
  })

  it('collapses punctuation/symbols into a single hyphen', () => {
    expect(slugify('Acme!! Slack??')).toBe('acme-slack')
  })

  it('trims leading and trailing whitespace/symbols', () => {
    expect(slugify('  Globex  ')).toBe('globex')
    expect(slugify('-globex-')).toBe('globex')
  })

  it('returns an empty string for input with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('')
  })

  it('always produces a slug accepted by isValidChannelId (when non-empty)', () => {
    for (const label of ['Acme Slack', 'Globex Corp #2', 'ntfy.sh topic']) {
      const id = slugify(label)
      expect(isValidChannelId(id)).toBe(true)
    }
  })
})

describe('isValidChannelId', () => {
  it('accepts lowercase letters, digits and hyphens starting with a letter or digit', () => {
    expect(isValidChannelId('acme-slack')).toBe(true)
    expect(isValidChannelId('acme2')).toBe(true)
    expect(isValidChannelId('2acme')).toBe(true)
  })

  it('rejects uppercase letters', () => {
    expect(isValidChannelId('Acme-Slack')).toBe(false)
  })

  it('rejects an id starting with a hyphen', () => {
    expect(isValidChannelId('-acme')).toBe(false)
  })

  it('rejects spaces and other symbols', () => {
    expect(isValidChannelId('acme slack')).toBe(false)
    expect(isValidChannelId('acme_slack')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidChannelId('')).toBe(false)
  })
})
