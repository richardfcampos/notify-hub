/**
 * Disabling a channel must deselect it from every profile's default
 * channels (not just hide the chip), keeping defaults a subset of enabled
 * channels so a Save & Apply never sends a default the backend rejects.
 */
import { describe, expect, it } from 'vitest'
import { pruneDefaultChannelsToEnabled } from './admin-defaults.js'

function makeConfig(channels, profiles) {
  return {
    channels: Object.fromEntries(
      Object.entries(channels).map(([name, enabled]) => [
        name,
        { enabled, values: {} }
      ])
    ),
    profiles: profiles.map((defaultChannels) => ({
      name: 'p',
      token: 't',
      defaultChannels
    })),
    extraKeys: {}
  }
}

describe('pruneDefaultChannelsToEnabled', () => {
  it('removes a now-disabled channel from a profile default and reports a change', () => {
    const config = makeConfig(
      { ntfy: true, whatsapp: false },
      [['ntfy', 'whatsapp']]
    )

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(true)
    expect(config.profiles[0].defaultChannels).toEqual(['ntfy'])
  })

  it('leaves defaults untouched and reports no change when all are enabled', () => {
    const config = makeConfig({ ntfy: true, discord: true }, [['ntfy', 'discord']])

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(false)
    expect(config.profiles[0].defaultChannels).toEqual(['ntfy', 'discord'])
  })

  it('prunes every profile independently', () => {
    const config = makeConfig(
      { ntfy: true, slack: false },
      [['slack'], ['ntfy', 'slack']]
    )

    const changed = pruneDefaultChannelsToEnabled(config)

    expect(changed).toBe(true)
    expect(config.profiles[0].defaultChannels).toEqual([])
    expect(config.profiles[1].defaultChannels).toEqual(['ntfy'])
  })

  it('is a no-op for a config with no profiles', () => {
    const config = makeConfig({ ntfy: false }, [])
    expect(pruneDefaultChannelsToEnabled(config)).toBe(false)
  })
})
