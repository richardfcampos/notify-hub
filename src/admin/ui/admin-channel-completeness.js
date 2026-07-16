/**
 * Pure per-type required-config completeness check (DBCH-09, tasks.md D10).
 * Mirrors the backend's "enabled instance missing a required key" rule
 * (empty/whitespace-only counts as missing) so the instance card can show an
 * inline warning BEFORE the operator hits Save and gets a 400 -- the
 * server-side check in config-validation.ts remains the source of truth.
 */

function isBlank(value) {
  return !value || value.trim() === ''
}

/** Required config keys of `channel` that are missing/blank, in `requiredConfig` order. */
export function missingRequiredKeys(channel, requiredConfig) {
  return requiredConfig.filter((key) => isBlank(channel.config[key]))
}

/** True when every required key for the channel's type has a non-blank value. */
export function isChannelConfigComplete(channel, requiredConfig) {
  return missingRequiredKeys(channel, requiredConfig).length === 0
}
