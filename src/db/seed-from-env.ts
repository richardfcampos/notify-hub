/**
 * One-time migration (DBCH-03): on first boot with an empty channels table,
 * seed the DB from the legacy `.env`-derived AppConfig. Each enabled channel
 * type becomes ONE instance named by its type (id = type, e.g. `slack`); a
 * type missing a required credential is seeded *disabled* rather than
 * blocking boot. Each TOKENS profile becomes a profile row whose default
 * channels are the just-created instance ids. Idempotent: a no-op the moment
 * the DB already holds any channel, so it never clobbers panel edits.
 */
import type { ChannelRepository, ProfileRepository } from '../core/ports.js'
import type { AppConfig } from '../core/types.js'
import { requiredConfigByChannel } from '../channels/channel-registry.js'

function titleCase(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

/** Legacy profile names -> a safe id slug; falls back to `profile` if empty. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'profile'
}

function hasAllRequired(
  config: Record<string, string>,
  requiredKeys: string[]
): boolean {
  return requiredKeys.every((key) => (config[key] ?? '').trim() !== '')
}

/**
 * Seeds channels + profiles from `appConfig` when the DB is empty.
 * @returns true if it seeded, false if the DB was already populated.
 */
export function seedFromEnvIfEmpty(
  channels: ChannelRepository,
  profiles: ProfileRepository,
  appConfig: AppConfig
): boolean {
  if (channels.list().length > 0) {
    return false
  }

  const createdIds = new Set<string>()
  for (const type of appConfig.channelsEnabled) {
    const config = appConfig.channelConfig[type] ?? {}
    const requiredKeys = requiredConfigByChannel[type] ?? []
    channels.upsert({
      id: type,
      label: titleCase(type),
      type,
      enabled: hasAllRequired(config, requiredKeys),
      config
    })
    createdIds.add(type)
  }

  for (const profile of appConfig.profiles) {
    profiles.upsert({
      id: slugify(profile.name),
      name: profile.name,
      token: profile.token,
      defaultChannels: profile.defaultChannels.filter((id) => createdIds.has(id))
    })
  }

  return true
}
