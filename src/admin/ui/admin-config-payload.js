/**
 * Assembles the working in-memory state into the exact PUT /api/config body
 * (DBCH-09, tasks.md D10). Pure -- no DOM, no fetch. Trims each channel's
 * `config` down to only the keys its TYPE actually requires (drops any
 * stray/leftover key so a save never ships garbage config), and copies
 * profiles' `defaultChannels` so the payload never aliases the live working
 * state the UI keeps mutating in place.
 */

function pickRequiredConfig(channel, requiredConfig) {
  const picked = {}
  for (const key of requiredConfig) {
    picked[key] = channel.config[key] ?? ''
  }
  return picked
}

/** `requiredConfigByType`: type -> required config key list (from GET /api/channel-types). An instance whose type isn't in the map (shouldn't happen -- Add-channel only offers known types) keeps its config as-is rather than silently dropping it. */
export function assembleConfigPayload(config, requiredConfigByType) {
  return {
    channels: config.channels.map((channel) => {
      const requiredConfig = requiredConfigByType[channel.type]
      return {
        id: channel.id,
        label: channel.label,
        type: channel.type,
        enabled: channel.enabled,
        config: requiredConfig ? pickRequiredConfig(channel, requiredConfig) : { ...channel.config }
      }
    }),
    profiles: config.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      token: profile.token,
      defaultChannels: [...profile.defaultChannels]
    }))
  }
}
