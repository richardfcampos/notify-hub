/**
 * Keeps every profile's default-channel list a subset of channel instances
 * that both EXIST and are enabled (DBCH-09, tasks.md D10 -- adapted from the
 * single-channel-per-type model to named instances). The backend rejects
 * saving a profile whose default channel doesn't exist in the payload or
 * isn't enabled; a disabled/deleted instance that lingers in the array
 * would still route notifications nowhere -- so when an instance is
 * disabled OR removed it must be *deselected* from every profile's
 * defaults, not merely hidden from the chip row. Pure (no DOM) so it's
 * unit-testable.
 *
 * @returns {boolean} true if any profile's defaults were pruned.
 */
export function pruneDefaultChannelsToEnabled(config) {
  const enabledIds = new Set(config.channels.filter((channel) => channel.enabled).map((channel) => channel.id))

  let changed = false
  for (const profile of config.profiles) {
    const kept = profile.defaultChannels.filter((id) => enabledIds.has(id))
    if (kept.length !== profile.defaultChannels.length) {
      profile.defaultChannels = kept
      changed = true
    }
  }
  return changed
}
