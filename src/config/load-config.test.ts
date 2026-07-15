/**
 * Tests derive from spec AC NOTIF-10 (config + fail-fast) and T3's
 * "Done when" list -- they assert observable outcomes (thrown message
 * content, parsed shape), not implementation internals.
 */
import { describe, it, expect } from 'vitest'
import { loadConfig } from './load-config.js'

describe('loadConfig', () => {
  it('throws naming the channel and the missing key when an enabled channel lacks a required credential (AC NOTIF-10.2)', () => {
    const env = { CHANNELS_ENABLED: 'slack' }
    const requiredConfigByChannel = { slack: ['SLACK_WEBHOOK_URL'] }

    expect(() => loadConfig(env, requiredConfigByChannel)).toThrowError(
      /slack/i
    )
    expect(() => loadConfig(env, requiredConfigByChannel)).toThrowError(
      /SLACK_WEBHOOK_URL/
    )
  })

  it('throws naming an unknown channel listed in CHANNELS_ENABLED', () => {
    const env = { CHANNELS_ENABLED: 'carrier-pigeon' }
    const requiredConfigByChannel = { slack: ['SLACK_WEBHOOK_URL'] }

    expect(() => loadConfig(env, requiredConfigByChannel)).toThrowError(
      /carrier-pigeon/
    )
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
      profiles: [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy'] }],
      channelsEnabled: ['ntfy'],
      channelConfig: { ntfy: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'mytopic' } },
      retry: { attempts: 3, backoffMs: 1000 }
    })
  })
})
