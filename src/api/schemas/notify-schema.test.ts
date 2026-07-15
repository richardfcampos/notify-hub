/**
 * Tests derive from spec NOTIF-01.3 + the edge cases ("message empty/
 * whitespace -> 400", "unknown channel -> 400") and T15's Done-when.
 * They assert the observable safeParse outcome (success flag + which field
 * failed), not schema internals. Active channels are fixed per-test.
 */
import { describe, expect, it } from 'vitest'
import { buildNotifySchema } from './notify-schema.js'

const active = ['ntfy', 'telegram', 'discord']

describe('buildNotifySchema', () => {
  it('accepts a minimal valid body (message only)', () => {
    const result = buildNotifySchema(active).safeParse({ message: 'hello' })
    expect(result.success).toBe(true)
  })

  it('accepts a fully-specified valid body', () => {
    const result = buildNotifySchema(active).safeParse({
      title: 'Build',
      message: 'passed',
      priority: 'high',
      tags: ['ci', 'green'],
      channels: ['ntfy', 'discord'],
      metadata: { project: 'notify-hub', dedupKey: 'abc' }
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toBe('passed')
      expect(result.data.channels).toEqual(['ntfy', 'discord'])
    }
  })

  it('rejects a missing message', () => {
    const result = buildNotifySchema(active).safeParse({ title: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty message', () => {
    const result = buildNotifySchema(active).safeParse({ message: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a whitespace-only message', () => {
    const result = buildNotifySchema(active).safeParse({ message: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a channels entry not in the active set, naming the channel', () => {
    const result = buildNotifySchema(active).safeParse({
      message: 'hi',
      channels: ['ntfy', 'bogus']
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'channels')
      expect(issue?.message).toContain('bogus')
    }
  })

  it('accepts a valid subset of active channels', () => {
    const result = buildNotifySchema(active).safeParse({
      message: 'hi',
      channels: ['telegram']
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-string message (wrong type)', () => {
    const result = buildNotifySchema(active).safeParse({ message: 123 })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid priority value', () => {
    const result = buildNotifySchema(active).safeParse({
      message: 'hi',
      priority: 'critical'
    })
    expect(result.success).toBe(false)
  })

  it('rejects tags that are not an array of strings', () => {
    const result = buildNotifySchema(active).safeParse({
      message: 'hi',
      tags: [1, 2]
    })
    expect(result.success).toBe(false)
  })
})
