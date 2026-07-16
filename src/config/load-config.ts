/**
 * Env -> typed AppConfig loader. Channels + profiles now live in the DB;
 * `.env` keeps infra (PORT, REDIS_URL, DB_PATH, retry) plus the LEGACY
 * TOKENS/CHANNELS_ENABLED which are parsed purely as SEED INPUT for the DB
 * on first boot. Because channel config is dynamic (edited live in the DB),
 * this loader NO LONGER fails fast on a missing/absent credential -- it just
 * captures whatever env values exist so the seeder can decide enablement
 * (an enabled-in-.env channel missing a required key seeds disabled). The
 * caller passes `requiredConfigByChannel` so this stays unit-testable without
 * importing any channel adapter; the real map comes from the registry.
 *
 * TOKENS format: `;`-separated profiles, each `name:token:channel1,channel2`.
 * The channel list may be empty (`name:token:`) meaning no default channels.
 */
import { z } from 'zod'
import type { AppConfig, Profile } from '../core/types.js'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  DB_PATH: z.string().min(1).default('./data/notify-hub.db'),
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
 * Parses/validates process env into a typed AppConfig. Throws only on
 * malformed TOKENS entries (a structural error the seeder can't recover
 * from). Channel credentials are captured best-effort as seed input: for
 * each CHANNELS_ENABLED entry it reads the registry-declared required keys
 * from env, keeping whatever is present. A missing key or an unknown channel
 * type does NOT throw -- the DB seeder marks incomplete channels disabled,
 * and the panel manages channels from here on.
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
    const requiredKeys = requiredConfigByChannel[channel] ?? []
    const cfg: Record<string, string> = {}
    for (const key of requiredKeys) {
      const value = env[key]
      // Best-effort capture: keep present values, omit missing ones (the
      // seeder treats an incomplete config as a disabled instance).
      if (value && value.trim() !== '') {
        cfg[key] = value
      }
    }
    channelConfig[channel] = cfg
  }

  return {
    port: parsedEnv.PORT,
    redisUrl: parsedEnv.REDIS_URL,
    dbPath: parsedEnv.DB_PATH,
    profiles,
    channelsEnabled,
    channelConfig,
    retry: {
      attempts: parsedEnv.RETRY_ATTEMPTS,
      backoffMs: parsedEnv.RETRY_BACKOFF_MS
    }
  }
}
