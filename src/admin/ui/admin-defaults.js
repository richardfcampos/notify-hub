/**
 * Keeps every profile's default-channel list a subset of the currently
 * enabled channels. The backend rejects saving a profile whose default
 * channel isn't enabled, and a disabled channel that lingers in the array
 * would still route notifications nowhere -- so when a channel is disabled
 * it must be *deselected* from every profile's defaults, not merely hidden
 * from the chip row. Pure (no DOM) so it's unit-testable.
 *
 * @returns {boolean} true if any profile's defaults were pruned.
 */
export function pruneDefaultChannelsToEnabled(config) {
  const enabled = new Set(
    Object.entries(config.channels)
      .filter(([, entry]) => entry.enabled)
      .map(([name]) => name)
  )

  let changed = false
  for (const profile of config.profiles) {
    const kept = profile.defaultChannels.filter((name) => enabled.has(name))
    if (kept.length !== profile.defaultChannels.length) {
      profile.defaultChannels = kept
      changed = true
    }
  }
  return changed
}
