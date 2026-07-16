/**
 * DBCH-03: seeding from a legacy .env-derived AppConfig. Each enabled type
 * becomes an instance named by its type; a type missing a required
 * credential seeds disabled (not skipped, not blocking); profiles carry
 * their default channels (filtered to created instances); and a populated
 * DB is left untouched (idempotent). Uses the in-memory fake repositories.
 */
import { describe, expect, it } from 'vitest'
import { seedFromEnvIfEmpty } from './seed-from-env.js'
import {
  FakeChannelRepository,
  FakeProfileRepository
} from '../../test/helpers/fakes.js'
import type { AppConfig } from '../core/types.js'

function appConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 8080,
    redisUrl: 'redis://localhost:6379',
    profiles: [],
    channelsEnabled: [],
    channelConfig: {},
    retry: { attempts: 5, backoffMs: 2000 },
    ...over
  }
}

describe('seedFromEnvIfEmpty', () => {
  it('seeds one instance per enabled channel type, named by type', () => {
    const channels = new FakeChannelRepository()
    const profiles = new FakeProfileRepository()

    const seeded = seedFromEnvIfEmpty(
      channels,
      profiles,
      appConfig({
        channelsEnabled: ['ntfy', 'discord'],
        channelConfig: {
          ntfy: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'secret' },
          discord: { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x' }
        }
      })
    )

    expect(seeded).toBe(true)
    expect(channels.list()).toEqual([
      {
        id: 'ntfy',
        label: 'Ntfy',
        type: 'ntfy',
        enabled: true,
        config: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'secret' }
      },
      {
        id: 'discord',
        label: 'Discord',
        type: 'discord',
        enabled: true,
        config: { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x' }
      }
    ])
  })

  it('seeds a channel missing a required credential as disabled', () => {
    const channels = new FakeChannelRepository()
    const profiles = new FakeProfileRepository()

    seedFromEnvIfEmpty(
      channels,
      profiles,
      appConfig({
        channelsEnabled: ['slack'],
        channelConfig: { slack: {} } // no SLACK_WEBHOOK_URL
      })
    )

    expect(channels.get('slack')).toMatchObject({ type: 'slack', enabled: false })
  })

  it('seeds profiles with their default channels filtered to created instances', () => {
    const channels = new FakeChannelRepository()
    const profiles = new FakeProfileRepository()

    seedFromEnvIfEmpty(
      channels,
      profiles,
      appConfig({
        channelsEnabled: ['ntfy'],
        channelConfig: { ntfy: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' } },
        profiles: [
          { name: 'Richard Campos', token: 'tok-1', defaultChannels: ['ntfy', 'slack'] }
        ]
      })
    )

    expect(profiles.list()).toEqual([
      {
        id: 'richard-campos',
        name: 'Richard Campos',
        token: 'tok-1',
        defaultChannels: ['ntfy'] // 'slack' filtered: not a created instance
      }
    ])
  })

  it('is a no-op when the DB already has channels (idempotent)', () => {
    const channels = new FakeChannelRepository([
      { id: 'acme-slack', label: 'Acme', type: 'slack', enabled: true, config: {} }
    ])
    const profiles = new FakeProfileRepository()

    const seeded = seedFromEnvIfEmpty(
      channels,
      profiles,
      appConfig({
        channelsEnabled: ['ntfy'],
        channelConfig: { ntfy: { NTFY_URL: 'x', NTFY_TOPIC: 'y' } },
        profiles: [{ name: 'x', token: 't', defaultChannels: [] }]
      })
    )

    expect(seeded).toBe(false)
    expect(channels.list()).toHaveLength(1)
    expect(profiles.list()).toHaveLength(0)
  })
})
