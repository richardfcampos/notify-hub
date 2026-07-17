/**
 * Entity-level config operations shared by the admin API and the MCP config
 * tools (spec MCPC-01..03, tasks.md C1). `PUT /api/config` (config-routes.ts)
 * treats the request as the full desired state and validates it directly;
 * these functions instead validate ONE entity change against a
 * would-be-full-state built from the current repositories, reusing the same
 * `validateConfigPayload` rules so both surfaces can never drift. Nothing is
 * written to a repository unless validation passes.
 */
import type { ChannelRepository, ProfileRepository } from '../core/ports.js'
import type { ChannelInstance, ProfileRecord } from '../core/types.js'
import { requiredConfigByChannel } from '../channels/channel-registry.js'
import { validateConfigPayload, type ConfigPayload } from './config-validation.js'
import { z } from 'zod'

/** Canonical zod shapes for a channel instance / profile record -- shared by config-routes.ts (whole-state PUT) and register-config-tools.ts (entity-level MCP tools) so the wire schema never drifts between the two surfaces. */
export const channelInstanceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string())
})

export const profileRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  token: z.string().min(1),
  defaultChannels: z.array(z.string())
})

export interface ConfigServiceDeps {
  channelRepo: ChannelRepository
  profileRepo: ProfileRepository
}

export type EntityResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Full desired-state shape straight from the repositories (GET /api/config, `get_config` tool). Secrets included in full -- same trust boundary as the panel. */
export function getFullConfig(deps: ConfigServiceDeps): ConfigPayload {
  return { channels: deps.channelRepo.list(), profiles: deps.profileRepo.list() }
}

/** Replaces the entry matching `item.id` in place, or appends it -- builds the "would-be" list a single upsert produces without touching the repository. */
function upsertedById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx === -1) {
    return [...list, item]
  }
  const next = [...list]
  next[idx] = item
  return next
}

/** Validates `channel` against the current state with it upserted; only writes on success (MCPC-02). */
export function upsertChannelEntity(deps: ConfigServiceDeps, channel: ChannelInstance): EntityResult<ChannelInstance> {
  const current = getFullConfig(deps)
  const candidatePayload: ConfigPayload = {
    channels: upsertedById(current.channels, channel),
    profiles: current.profiles
  }
  const validation = validateConfigPayload(candidatePayload, requiredConfigByChannel)
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }
  deps.channelRepo.upsert(channel)
  return { ok: true, value: channel }
}

/** Deletes a channel instance and prunes it from every profile's default channels (MCPC-03 edge case). Unknown id -> error naming it, nothing changes. */
export function deleteChannelEntity(deps: ConfigServiceDeps, id: string): EntityResult<void> {
  const existing = deps.channelRepo.get(id)
  if (!existing) {
    return { ok: false, error: `unknown channel "${id}"` }
  }
  deps.channelRepo.delete(id)
  for (const profile of deps.profileRepo.list()) {
    if (profile.defaultChannels.includes(id)) {
      deps.profileRepo.setDefaultChannels(
        profile.id,
        profile.defaultChannels.filter((channelId) => channelId !== id)
      )
    }
  }
  return { ok: true, value: undefined }
}

/** Validates `profile` against the current state with it upserted (default-channel refs must exist + be enabled; duplicate token across profiles rejected); only writes on success (MCPC-03). */
export function upsertProfileEntity(deps: ConfigServiceDeps, profile: ProfileRecord): EntityResult<ProfileRecord> {
  const current = getFullConfig(deps)
  const candidatePayload: ConfigPayload = {
    channels: current.channels,
    profiles: upsertedById(current.profiles, profile)
  }
  const validation = validateConfigPayload(candidatePayload, requiredConfigByChannel)
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }
  deps.profileRepo.upsert(profile)
  return { ok: true, value: profile }
}

/** Unknown id -> error naming it, nothing changes. */
export function deleteProfileEntity(deps: ConfigServiceDeps, id: string): EntityResult<void> {
  const existing = deps.profileRepo.get(id)
  if (!existing) {
    return { ok: false, error: `unknown profile "${id}"` }
  }
  deps.profileRepo.delete(id)
  return { ok: true, value: undefined }
}
