/**
 * Tests derive from spec DBCH-07/08 (config now seeds the DB; fail-fast moved
 * to write-time + send-time) -- they assert observable outcomes (no throw on
 * incomplete channel creds, parsed seed shape, DB_PATH), not internals. The
 * former startup fail-fast is now SEED behavior: an enabled-in-.env channel
 * missing a required key still parses (captured as an incomplete config the
 * seeder disables), and an unknown channel type does not block boot.
 */
import { describe, it, expect } from 'vitest'
import { loadConfig } from './load-config.js'

describe('loadConfig', () => {
  it('does not throw for an enabled channel missing a required credential; captures the partial config as seed input', () => {
    const env = { CHANNELS_ENABLED: 'slack' }
    const requiredConfigByChannel = { slack: ['SLACK_WEBHOOK_URL'] }

    const config = loadConfig(env, requiredConfigByChannel)

    expect(config.channelsEnabled).toEqual(['slack'])
    // Missing key omitted -> incomplete config the seeder will disable.
    expect(config.channelConfig.slack).toEqual({})
  })

  it('does not throw for an unknown channel type listed in CHANNELS_ENABLED; captures it with an empty config', () => {
    const env = { CHANNELS_ENABLED: 'carrier-pigeon' }
    const requiredConfigByChannel = { slack: ['SLACK_WEBHOOK_URL'] }

    const config = loadConfig(env, requiredConfigByChannel)

    expect(config.channelsEnabled).toEqual(['carrier-pigeon'])
    expect(config.channelConfig['carrier-pigeon']).toEqual({})
  })

  it('reads DB_PATH from env, defaulting to ./data/notify-hub.db', () => {
    expect(loadConfig({}, {}).dbPath).toBe('./data/notify-hub.db')
    expect(loadConfig({ DB_PATH: '/data/custom.db' }, {}).dbPath).toBe('/data/custom.db')
  })

  it('parses TOKENS into Profile[] with correct defaultChannels', () => {
    const env = {
      TOKENS: 'phone:tok123:ntfy,telegram;desktop:tok456:discord'
    }

    const config = loadConfig(env, {})

    expect(config.profiles).toEqual([
      { name: 'phone', token: 'tok123', defaultChannels: ['ntfy', 'telegram'] },
      { name: 'desktop', token: 'tok456', defaultChannels: ['discord'] }
    ])
  })

  it('parses a profile with no default channels (trailing empty channel list)', () => {
    const env = { TOKENS: 'admin:tokabc:' }

    const config = loadConfig(env, {})

    expect(config.profiles).toEqual([
      { name: 'admin', token: 'tokabc', defaultChannels: [] }
    ])
  })

  it('returns typed AppConfig with defaults when optional env vars are absent (happy path)', () => {
    const config = loadConfig({}, {})

    expect(config).toEqual({
      port: 3000,
      redisUrl: 'redis://localhost:6379',
      dbPath: './data/notify-hub.db',
      profiles: [],
      channelsEnabled: [],
      channelConfig: {},
      retry: { attempts: 5, backoffMs: 2000 }
    })
  })

  it('returns typed AppConfig with expected fields for a fully-specified happy path', () => {
    const env = {
      PORT: '4000',
      REDIS_URL: 'redis://myhost:6380',
      DB_PATH: '/data/custom.db',
      TOKENS: 'phone:tok:ntfy',
      CHANNELS_ENABLED: 'ntfy',
      NTFY_URL: 'https://ntfy.sh',
      NTFY_TOPIC: 'mytopic',
      RETRY_ATTEMPTS: '3',
      RETRY_BACKOFF_MS: '1000'
    }
    const requiredConfigByChannel = { ntfy: ['NTFY_URL', 'NTFY_TOPIC'] }

    const config = loadConfig(env, requiredConfigByChannel)

    expect(config).toEqual({
      port: 4000,
      redisUrl: 'redis://myhost:6380',
      dbPath: '/data/custom.db',
      profiles: [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy'] }],
      channelsEnabled: ['ntfy'],
      channelConfig: { ntfy: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'mytopic' } },
      retry: { attempts: 3, backoffMs: 1000 }
    })
  })
})
