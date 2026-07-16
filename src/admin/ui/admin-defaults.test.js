/**
 * Disabling OR deleting an instance must deselect it from every profile's
 * default channels (not just hide its chip), keeping defaults a subset of
 * enabled EXISTING instances so a Save never sends a default the backend
 * rejects (config-validation.ts).
 */
import { describe, expect, it } from 'vitest'
import { pruneDefaultChannelsToEnabled } from './admin-defaults.js'

function makeConfig(channels, profiles) {
  return {
    channels: channels.map(([id, enabled]) => ({ id, label: id, type: 'ntfy', enabled, config: {} })),
    profiles: profiles.map((defaultChannels) => ({
      id: 'p',
      name: 'p',
      token: 't',
      defaultChannels
    })),
    extraKeys: {}
  }
}

describe('pruneDefaultChannelsToEnabled', () => {
  it('removes a now-disabled instance id from a profile default and reports a change', () => {
    const config = makeConfig(
      [
        ['acme-ntfy', true],
        ['acme-whatsapp', false]
      ],
      [['acme-ntfy', 'acme-whatsapp']]
    )

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(true)
    expect(config.profiles[0].defaultChannels).toEqual(['acme-ntfy'])
  })

  it('removes a default id that no longer exists at all (deleted instance)', () => {
    const config = makeConfig([['acme-ntfy', true]], [['acme-ntfy', 'deleted-channel']])

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(true)
    expect(config.profiles[0].defaultChannels).toEqual(['acme-ntfy'])
  })

  it('leaves defaults untouched and reports no change when all are enabled', () => {
    const config = makeConfig(
      [
        ['acme-ntfy', true],
        ['acme-discord', true]
      ],
      [['acme-ntfy', 'acme-discord']]
    )

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(false)
    expect(config.profiles[0].defaultChannels).toEqual(['acme-ntfy', 'acme-discord'])
  })

  it('prunes every profile independently', () => {
    const config = makeConfig(
      [
        ['acme-ntfy', true],
        ['acme-slack', false]
      ],
      [['acme-slack'], ['acme-ntfy', 'acme-slack']]
    )

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(true)
    expect(config.profiles[0].defaultChannels).toEqual([])
    expect(config.profiles[1].defaultChannels).toEqual(['acme-ntfy'])
  })

  it('is a no-op for a config with no profiles', () => {
    const config = makeConfig([['acme-ntfy', false]], [])
    expect(pruneDefaultChannelsToEnabled(config)).toBe(false)
  })
})
