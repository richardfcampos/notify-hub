/**
 * Write-time validation for PUT /api/config (spec DBCH-08, tasks.md D9).
 * The payload is the FULL desired state (all channel instances + all
 * profiles) -- this module checks it in isolation, before anything touches
 * the DB, so a rejected write leaves every row exactly as it was
 * (validate-all-then-write; the repository ports don't expose cross-call
 * transactions, so atomicity comes from never writing until every check
 * below has passed).
 *
 * Checks, in order (each 400s naming the offending id/key so the operator
 * can fix it, mirroring the old .env-era validator's message style):
 * 1. every channel id is a safe slug
 * 2. no duplicate channel ids in the payload
 * 3. every channel's `type` is a known registry type
 * 4. an enabled channel has every required config key (empty string counts
 *    as missing)
 * 5. every profile's default-channel refs point at a channel THAT EXISTS in
 *    the payload AND is enabled
 * 6. no duplicate profile tokens in the payload
 */
import type { ChannelInstance, ProfileRecord } from '../core/types.js'

/** Slug: lowercase letters/digits, then any run of lowercase letters/digits/hyphens. Mirrors the UI's client-side slugify (admin-ui/instance-id.js) exactly. */
export const CHANNEL_ID_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

export interface ConfigPayload {
  channels: ChannelInstance[]
  profiles: ProfileRecord[]
}

export type ConfigValidation = { ok: true } | { ok: false; error: string }

/** Empty/whitespace-only counts as missing, matching the old .env-era rule. */
function isBlank(value: string | undefined): boolean {
  return !value || value.trim() === ''
}

function validateChannels(
  channels: ChannelInstance[],
  requiredConfigByType: Record<string, string[]>
): ConfigValidation {
  const seenIds = new Set<string>()

  for (const channel of channels) {
    if (!CHANNEL_ID_SLUG_RE.test(channel.id)) {
      return {
        ok: false,
        error: `Channel id "${channel.id}" is not a valid slug (lowercase letters, digits and hyphens, starting with a letter or digit)`
      }
    }

    if (seenIds.has(channel.id)) {
      return { ok: false, error: `Duplicate channel id "${channel.id}"` }
    }
    seenIds.add(channel.id)

    const requiredKeys = requiredConfigByType[channel.type]
    if (!requiredKeys) {
      return { ok: false, error: `Channel "${channel.id}" has unknown type "${channel.type}"` }
    }

    if (!channel.enabled) {
      continue
    }
    for (const key of requiredKeys) {
      if (isBlank(channel.config[key])) {
        return {
          ok: false,
          error: `Channel "${channel.id}" is enabled but missing required config "${key}"`
        }
      }
    }
  }

  return { ok: true }
}

function validateProfiles(profiles: ProfileRecord[], channelsById: Map<string, ChannelInstance>): ConfigValidation {
  const seenTokens = new Set<string>()

  for (const profile of profiles) {
    if (seenTokens.has(profile.token)) {
      return { ok: false, error: `Duplicate token for profile "${profile.name}"` }
    }
    seenTokens.add(profile.token)

    for (const ref of profile.defaultChannels) {
      const channel = channelsById.get(ref)
      if (!channel) {
        return {
          ok: false,
          error: `Profile "${profile.name}" has default channel "${ref}" which does not exist`
        }
      }
      if (!channel.enabled) {
        return {
          ok: false,
          error: `Profile "${profile.name}" has default channel "${ref}" which is not enabled`
        }
      }
    }
  }

  return { ok: true }
}

/** Runs every check; returns the FIRST failure (channels before profiles, in array order) so the error message is deterministic. */
export function validateConfigPayload(
  payload: ConfigPayload,
  requiredConfigByType: Record<string, string[]>
): ConfigValidation {
  const channelsValidation = validateChannels(payload.channels, requiredConfigByType)
  if (!channelsValidation.ok) {
    return channelsValidation
  }

  const channelsById = new Map(payload.channels.map((c) => [c.id, c]))
  return validateProfiles(payload.profiles, channelsById)
}
