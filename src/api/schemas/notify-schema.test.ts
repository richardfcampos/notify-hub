/**
 * Tests derive from spec NOTIF-01.3 + the edge cases ("message empty/
 * whitespace -> 400"). They assert the observable safeParse outcome (success
 * flag + which field failed), not schema internals. The schema now validates
 * STRUCTURE only -- whether a `channels` entry is a known instance id is a
 * repository lookup in the route (see server.e2e), so `channels` here just
 * has to be an array of strings.
 */
import { describe, expect, it } from 'vitest'
import { buildNotifySchema } from './notify-schema.js'

describe('buildNotifySchema', () => {
  it('accepts a minimal valid body (message only)', () => {
    const result = buildNotifySchema().safeParse({ message: 'hello' })
    expect(result.success).toBe(true)
  })

  it('accepts a fully-specified valid body', () => {
    const result = buildNotifySchema().safeParse({
      title: 'Build',
      message: 'passed',
      priority: 'high',
      tags: ['ci', 'green'],
      channels: ['acme-slack', 'globex-discord'],
      metadata: { project: 'notify-hub', dedupKey: 'abc' }
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toBe('passed')
      expect(result.data.channels).toEqual(['acme-slack', 'globex-discord'])
    }
  })

  it('rejects a missing message', () => {
    const result = buildNotifySchema().safeParse({ title: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty message', () => {
    const result = buildNotifySchema().safeParse({ message: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a whitespace-only message', () => {
    const result = buildNotifySchema().safeParse({ message: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a channels entry that is not a string (shape check)', () => {
    const result = buildNotifySchema().safeParse({
      message: 'hi',
      channels: ['acme-slack', 123]
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'channels')
      expect(issue).toBeDefined()
    }
  })

  it('accepts any array-of-strings channels (id validity is checked in the route, not here)', () => {
    const result = buildNotifySchema().safeParse({
      message: 'hi',
      channels: ['anything-goes-at-schema-level']
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-string message (wrong type)', () => {
    const result = buildNotifySchema().safeParse({ message: 123 })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid priority value', () => {
    const result = buildNotifySchema().safeParse({
      message: 'hi',
      priority: 'critical'
    })
    expect(result.success).toBe(false)
  })

  it('rejects tags that are not an array of strings', () => {
    const result = buildNotifySchema().safeParse({
      message: 'hi',
      tags: [1, 2]
    })
    expect(result.success).toBe(false)
  })
})
