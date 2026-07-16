/**
 * Tests derive from spec DBCH-08 (tasks.md D9) write-time validation rules:
 * slug id, duplicate ids, unknown type, enabled-missing-config (empty string
 * counts as missing), profile default refs (must exist + be enabled in the
 * SAME payload), duplicate profile tokens, and the happy path.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelInstance, ProfileRecord } from '../core/types.js'
import { validateConfigPayload, type ConfigPayload } from './config-validation.js'

const requiredConfigByType: Record<string, string[]> = {
  ntfy: ['NTFY_URL', 'NTFY_TOPIC'],
  slack: ['SLACK_WEBHOOK_URL']
}

function channel(over: Partial<ChannelInstance> & { id: string }): ChannelInstance {
  return { label: over.id, type: 'ntfy', enabled: true, config: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' }, ...over }
}

function profile(over: Partial<ProfileRecord> & { id: string; token: string }): ProfileRecord {
  return { name: over.id, defaultChannels: [], ...over }
}

function payload(channels: ChannelInstance[], profiles: ProfileRecord[] = []): ConfigPayload {
  return { channels, profiles }
}

describe('validateConfigPayload', () => {
  it('passes a fully valid payload (happy path)', () => {
    const cfg = payload(
      [channel({ id: 'acme-ntfy' })],
      [profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })]
    )

    expect(validateConfigPayload(cfg, requiredConfigByType)).toEqual({ ok: true })
  })

  it('passes an empty payload (no channels, no profiles)', () => {
    expect(validateConfigPayload(payload([], []), requiredConfigByType)).toEqual({ ok: true })
  })

  it('rejects an id with uppercase letters, naming it', () => {
    const cfg = payload([channel({ id: 'Acme-Ntfy' })])

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('"Acme-Ntfy"')
  })

  it('rejects an id starting with a hyphen', () => {
    const cfg = payload([channel({ id: '-acme' })])

    expect(validateConfigPayload(cfg, requiredConfigByType).ok).toBe(false)
  })

  it('rejects an id containing spaces', () => {
    const cfg = payload([channel({ id: 'acme slack' })])

    expect(validateConfigPayload(cfg, requiredConfigByType).ok).toBe(false)
  })

  it('rejects duplicate channel ids in the payload, naming the id', () => {
    const cfg = payload([channel({ id: 'acme-ntfy' }), channel({ id: 'acme-ntfy' })])

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result).toEqual({ ok: false, error: 'Duplicate channel id "acme-ntfy"' })
  })

  it('rejects a channel with a type not in the registry, naming instance + type', () => {
    const cfg = payload([channel({ id: 'acme-x', type: 'carrier-pigeon' })])

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result).toEqual({ ok: false, error: 'Channel "acme-x" has unknown type "carrier-pigeon"' })
  })

  it('rejects an enabled channel missing a required config key, naming instance + key', () => {
    const cfg = payload([channel({ id: 'acme-slack', type: 'slack', config: {} })])

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result).toEqual({
      ok: false,
      error: 'Channel "acme-slack" is enabled but missing required config "SLACK_WEBHOOK_URL"'
    })
  })

  it('treats a whitespace-only config value as missing (edge case)', () => {
    const cfg = payload([channel({ id: 'acme-slack', type: 'slack', config: { SLACK_WEBHOOK_URL: '   ' } })])

    expect(validateConfigPayload(cfg, requiredConfigByType).ok).toBe(false)
  })

  it('allows a DISABLED channel to be missing its required config (fail-fast is write-time only for enabled instances)', () => {
    const cfg = payload([channel({ id: 'acme-slack', type: 'slack', enabled: false, config: {} })])

    expect(validateConfigPayload(cfg, requiredConfigByType)).toEqual({ ok: true })
  })

  it('rejects a profile default channel that does not exist in the payload, naming profile + ref', () => {
    const cfg = payload(
      [channel({ id: 'acme-ntfy' })],
      [profile({ id: 'acme', token: 'tok', defaultChannels: ['ghost'] })]
    )

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result).toEqual({
      ok: false,
      error: 'Profile "acme" has default channel "ghost" which does not exist'
    })
  })

  it('rejects a profile default channel that exists but is disabled, naming profile + ref', () => {
    const cfg = payload(
      [channel({ id: 'acme-ntfy', enabled: false })],
      [profile({ id: 'acme', token: 'tok', defaultChannels: ['acme-ntfy'] })]
    )

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result).toEqual({
      ok: false,
      error: 'Profile "acme" has default channel "acme-ntfy" which is not enabled'
    })
  })

  it('rejects duplicate profile tokens in the payload, naming the later profile', () => {
    const cfg = payload(
      [],
      [profile({ id: 'acme', token: 'shared' }), profile({ id: 'globex', token: 'shared' })]
    )

    const result = validateConfigPayload(cfg, requiredConfigByType)

    expect(result).toEqual({ ok: false, error: 'Duplicate token for profile "globex"' })
  })

  it('allows a profile with no default channels', () => {
    const cfg = payload([], [profile({ id: 'acme', token: 'tok', defaultChannels: [] })])

    expect(validateConfigPayload(cfg, requiredConfigByType)).toEqual({ ok: true })
  })
})
