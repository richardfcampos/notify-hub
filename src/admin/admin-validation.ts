/**
 * Save-time validation for AdminConfig (spec ADMIN-03, mirrors the
 * gateway's own fail-fast rule in config/load-config.ts): an enabled
 * channel missing one of its required values is rejected naming the
 * channel + key, and a profile's default channel that isn't enabled is
 * rejected naming it. Both checks run before anything is written to disk
 * (PUT /api/config calls this first).
 */
import type { AdminConfig, ChannelSchema } from './admin-config.js'

export type AdminConfigValidation = { ok: true } | { ok: false; error: string }

export function validateAdminConfig(
  cfg: AdminConfig,
  registry: Record<string, ChannelSchema>
): AdminConfigValidation {
  for (const [channelName, entry] of Object.entries(cfg.channels)) {
    if (!entry.enabled) {
      continue
    }
    const requiredKeys = registry[channelName]?.requiredConfig ?? []
    for (const key of requiredKeys) {
      const value = entry.values[key]
      if (!value || value.trim() === '') {
        return {
          ok: false,
          error: `Channel "${channelName}" is enabled but missing required config "${key}"`
        }
      }
    }
  }

  const enabledChannels = new Set(
    Object.entries(cfg.channels)
      .filter(([, entry]) => entry.enabled)
      .map(([name]) => name)
  )

  for (const profile of cfg.profiles) {
    for (const channel of profile.defaultChannels) {
      if (!enabledChannels.has(channel)) {
        return {
          ok: false,
          error: `Profile "${profile.name}" has default channel "${channel}" which is not enabled`
        }
      }
    }
  }

  return { ok: true }
}
