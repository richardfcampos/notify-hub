/**
 * DBCH-02: channel + profile repositories round-trip through a real
 * temp-file SQLite database (no mocking) -- config JSON + boolean enabled
 * survive, upsert updates in place (no duplicate rows), listEnabled filters,
 * profile defaults live in the join table and round-trip, resolveByToken
 * works, delete cascades, and a profile default pointing at a non-existent
 * channel is pruned (foreign key), keeping defaults a subset of instances.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { openDatabase } from './database.js'
import { SqliteChannelRepository } from './sqlite-channel-repository.js'
import { SqliteProfileRepository } from './sqlite-profile-repository.js'
import type { ChannelInstance } from '../core/types.js'

let dir: string
let db: BetterSqlite3.Database
let channels: SqliteChannelRepository
let profiles: SqliteProfileRepository

function channel(over: Partial<ChannelInstance> & { id: string }): ChannelInstance {
  return {
    label: over.id,
    type: 'slack',
    enabled: true,
    config: {},
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notify-hub-repo-test-'))
  db = openDatabase(join(dir, 'notify-hub.db'))
  channels = new SqliteChannelRepository(db)
  profiles = new SqliteProfileRepository(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('SqliteChannelRepository', () => {
  it('round-trips config JSON and the boolean enabled flag', () => {
    channels.upsert(
      channel({
        id: 'acme-slack',
        label: 'Acme Slack',
        type: 'slack',
        enabled: true,
        config: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/acme' }
      })
    )

    expect(channels.get('acme-slack')).toEqual({
      id: 'acme-slack',
      label: 'Acme Slack',
      type: 'slack',
      enabled: true,
      config: { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/acme' }
    })
  })

  it('stores multiple named instances of the same type independently', () => {
    channels.upsert(channel({ id: 'acme-slack', config: { SLACK_WEBHOOK_URL: 'a' } }))
    channels.upsert(channel({ id: 'globex-slack', config: { SLACK_WEBHOOK_URL: 'b' } }))

    const all = channels.list()
    expect(all.map((c) => c.id)).toEqual(['acme-slack', 'globex-slack'])
    expect(channels.get('acme-slack')?.config.SLACK_WEBHOOK_URL).toBe('a')
    expect(channels.get('globex-slack')?.config.SLACK_WEBHOOK_URL).toBe('b')
  })

  it('upsert on an existing id updates in place (no duplicate row)', () => {
    channels.upsert(channel({ id: 'acme-slack', label: 'Old' }))
    channels.upsert(channel({ id: 'acme-slack', label: 'New', enabled: false }))

    expect(channels.list()).toHaveLength(1)
    expect(channels.get('acme-slack')).toMatchObject({ label: 'New', enabled: false })
  })

  it('listEnabled returns only enabled instances', () => {
    channels.upsert(channel({ id: 'on', enabled: true }))
    channels.upsert(channel({ id: 'off', enabled: false }))

    expect(channels.listEnabled().map((c) => c.id)).toEqual(['on'])
  })

  it('get returns null for an unknown id and delete removes the row', () => {
    expect(channels.get('missing')).toBeNull()
    channels.upsert(channel({ id: 'acme-slack' }))
    channels.delete('acme-slack')
    expect(channels.get('acme-slack')).toBeNull()
  })
})

describe('SqliteProfileRepository', () => {
  beforeEach(() => {
    channels.upsert(channel({ id: 'acme-slack' }))
    channels.upsert(channel({ id: 'acme-email', type: 'email' }))
  })

  it('round-trips a profile and its default channels', () => {
    profiles.upsert({
      id: 'acme',
      name: 'Acme',
      token: 'tok-acme',
      defaultChannels: ['acme-slack', 'acme-email']
    })

    expect(profiles.get('acme')).toEqual({
      id: 'acme',
      name: 'Acme',
      token: 'tok-acme',
      defaultChannels: ['acme-email', 'acme-slack']
    })
  })

  it('resolves a profile by token and returns null for unknown/empty tokens', () => {
    profiles.upsert({ id: 'acme', name: 'Acme', token: 'tok-acme', defaultChannels: [] })

    expect(profiles.resolveByToken('tok-acme')?.id).toBe('acme')
    expect(profiles.resolveByToken('nope')).toBeNull()
    expect(profiles.resolveByToken(undefined)).toBeNull()
    expect(profiles.resolveByToken('')).toBeNull()
  })

  it('setDefaultChannels replaces the previous selection', () => {
    profiles.upsert({
      id: 'acme',
      name: 'Acme',
      token: 'tok-acme',
      defaultChannels: ['acme-slack', 'acme-email']
    })

    profiles.setDefaultChannels('acme', ['acme-email'])

    expect(profiles.get('acme')?.defaultChannels).toEqual(['acme-email'])
  })

  it('prunes a default that points at a non-existent channel (foreign key)', () => {
    profiles.upsert({
      id: 'acme',
      name: 'Acme',
      token: 'tok-acme',
      defaultChannels: ['acme-slack', 'ghost-channel']
    })

    expect(profiles.get('acme')?.defaultChannels).toEqual(['acme-slack'])
  })

  it('deleting a profile cascades its default-channel rows', () => {
    profiles.upsert({
      id: 'acme',
      name: 'Acme',
      token: 'tok-acme',
      defaultChannels: ['acme-slack']
    })

    profiles.delete('acme')

    expect(profiles.get('acme')).toBeNull()
    const orphans = db
      .prepare('SELECT COUNT(*) AS n FROM profile_channels WHERE profile_id = ?')
      .get('acme') as { n: number }
    expect(orphans.n).toBe(0)
  })

  it('deleting a channel cascades it out of every profile default', () => {
    profiles.upsert({
      id: 'acme',
      name: 'Acme',
      token: 'tok-acme',
      defaultChannels: ['acme-slack', 'acme-email']
    })

    channels.delete('acme-slack')

    expect(profiles.get('acme')?.defaultChannels).toEqual(['acme-email'])
  })
})
