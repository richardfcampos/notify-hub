/**
 * Env -> typed AppConfig loader with fail-fast channel-credential validation
 * (spec NOTIF-10). Never constructs channel adapters itself: the caller
 * passes `requiredConfigByChannel` (channel name -> required env keys) so
 * this module stays unit-testable without importing any channel adapter.
 * The real map is assembled later from the channel registry.
 *
 * TOKENS format: `;`-separated profiles, each `name:token:channel1,channel2`.
 * The channel list may be empty (`name:token:`) meaning no default channels.
 * Example: "phone:supersecrettoken:ntfy,telegram;desktop:othertoken:discord"
 * (documented identically in .env.example).
 */
import { z } from 'zod'
import type { AppConfig, Profile } from '../core/types.js'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  TOKENS: z.string().optional().default(''),
  CHANNELS_ENABLED: z.string().optional().default(''),
  RETRY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(2000)
})

function parseCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parseTokens(raw: string): Profile[] {
  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split(':')
      if (parts.length !== 3) {
        throw new Error(
          `Invalid TOKENS entry "${entry}": expected format name:token:channel1,channel2`
        )
      }
      const [name, token, channelsCsv] = parts
      if (!name || !token) {
        throw new Error(
          `Invalid TOKENS entry "${entry}": name and token must be non-empty`
        )
      }
      return { name, token, defaultChannels: parseCsv(channelsCsv) }
    })
}

/**
 * Parses/validates process env into a typed AppConfig. Throws on:
 * - malformed TOKENS entries
 * - a channel in CHANNELS_ENABLED that isn't a key of `requiredConfigByChannel`
 * - a channel in CHANNELS_ENABLED missing one of its required env keys
 * Thrown error messages always name the offending channel (and key, where
 * applicable) so misconfiguration is diagnosable from the message alone.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  requiredConfigByChannel: Record<string, string[]>
): AppConfig {
  const parsedEnv = envSchema.parse(env)

  const profiles = parseTokens(parsedEnv.TOKENS)
  const channelsEnabled = parseCsv(parsedEnv.CHANNELS_ENABLED)

  const channelConfig: Record<string, Record<string, string>> = {}
  for (const channel of channelsEnabled) {
    const requiredKeys = requiredConfigByChannel[channel]
    if (!requiredKeys) {
      throw new Error(
        `Unknown channel "${channel}" listed in CHANNELS_ENABLED (no registry entry)`
      )
    }
    const cfg: Record<string, string> = {}
    for (const key of requiredKeys) {
      const value = env[key]
      if (!value || value.trim() === '') {
        throw new Error(
          `Channel "${channel}" is enabled but missing required config "${key}"`
        )
      }
      cfg[key] = value
    }
    channelConfig[channel] = cfg
  }

  return {
    port: parsedEnv.PORT,
    redisUrl: parsedEnv.REDIS_URL,
    profiles,
    channelsEnabled,
    channelConfig,
    retry: {
      attempts: parsedEnv.RETRY_ATTEMPTS,
      backoffMs: parsedEnv.RETRY_BACKOFF_MS
    }
  }
}
