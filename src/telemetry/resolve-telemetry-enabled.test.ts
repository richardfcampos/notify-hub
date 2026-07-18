/**
 * Truth table for the opt-in gate (spec TEL-01 AC1/AC2). Every disable path
 * must resolve to `false` so callers never construct a real PostHog client
 * from it -- tested purely as a function, no I/O.
 */
import { describe, expect, it } from 'vitest'
import { isTelemetryEnabled } from './resolve-telemetry-enabled.js'

describe('isTelemetryEnabled', () => {
  it('is false when both env vars are unset', () => {
    expect(isTelemetryEnabled({})).toBe(false)
  })

  it('is true when TELEMETRY_ENABLED=true and DO_NOT_TRACK is unset', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: 'true' })).toBe(true)
  })

  it('is false when TELEMETRY_ENABLED=true but DO_NOT_TRACK is also set', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: 'true', DO_NOT_TRACK: '1' })).toBe(false)
  })

  it('is false when only DO_NOT_TRACK is set (gate #1 already blocks)', () => {
    expect(isTelemetryEnabled({ DO_NOT_TRACK: '1' })).toBe(false)
  })

  it('accepts case-insensitive TRUE', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: 'TRUE' })).toBe(true)
  })

  it('accepts "1" as truthy', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: '1' })).toBe(true)
  })

  it('is false for "false"', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: 'false' })).toBe(false)
  })

  it('is false for "0"', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: '0' })).toBe(false)
  })

  it('is false for an empty string', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: '' })).toBe(false)
  })

  it('DO_NOT_TRACK with any non-empty value disables regardless of content', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: 'true', DO_NOT_TRACK: 'false' })).toBe(false)
  })

  it('an empty-string DO_NOT_TRACK does not count as "set"', () => {
    expect(isTelemetryEnabled({ TELEMETRY_ENABLED: 'true', DO_NOT_TRACK: '' })).toBe(true)
  })
})
