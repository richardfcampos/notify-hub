/**
 * SQLite-backed ProfileRepository (DBCH-02). A profile's default channels
 * live in the profile_channels join table; `upsert`/`setDefaultChannels`
 * replace them transactionally. References to non-existent channels are
 * pruned explicitly (SQLite's OR IGNORE does NOT apply to foreign keys),
 * so a profile's defaults stay a subset of existing instances (spec
 * DBCH-02, "reference pruned"). `delete` cascades the join rows via the
 * foreign key.
 */
import type Database from 'better-sqlite3'
import type { ProfileRepository } from '../core/ports.js'
import type { ProfileRecord } from '../core/types.js'

interface ProfileRow {
  id: string
  name: string
  token: string
}

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly db: Database.Database) {}

  private defaultChannelsFor(profileId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT channel_id FROM profile_channels WHERE profile_id = ? ORDER BY channel_id'
      )
      .all(profileId) as { channel_id: string }[]
    return rows.map((row) => row.channel_id)
  }

  private rowToRecord(row: ProfileRow): ProfileRecord {
    return {
      id: row.id,
      name: row.name,
      token: row.token,
      defaultChannels: this.defaultChannelsFor(row.id)
    }
  }

  list(): ProfileRecord[] {
    const rows = this.db
      .prepare('SELECT id, name, token FROM profiles ORDER BY created_at, id')
      .all() as ProfileRow[]
    return rows.map((row) => this.rowToRecord(row))
  }

  get(id: string): ProfileRecord | null {
    const row = this.db
      .prepare('SELECT id, name, token FROM profiles WHERE id = ?')
      .get(id) as ProfileRow | undefined
    return row ? this.rowToRecord(row) : null
  }

  resolveByToken(token: string | undefined): ProfileRecord | null {
    if (!token) {
      return null
    }
    const row = this.db
      .prepare('SELECT id, name, token FROM profiles WHERE token = ?')
      .get(token) as ProfileRow | undefined
    return row ? this.rowToRecord(row) : null
  }

  upsert(profile: ProfileRecord): void {
    const run = this.db.transaction((p: ProfileRecord) => {
      this.db
        .prepare(
          `INSERT INTO profiles (id, name, token, created_at)
           VALUES (@id, @name, @token, @created_at)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, token = excluded.token`
        )
        .run({
          id: p.id,
          name: p.name,
          token: p.token,
          created_at: new Date().toISOString()
        })
      this.replaceDefaultChannels(p.id, p.defaultChannels)
    })
    run(profile)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  }

  setDefaultChannels(profileId: string, channelIds: string[]): void {
    const run = this.db.transaction((ids: string[]) =>
      this.replaceDefaultChannels(profileId, ids)
    )
    run(channelIds)
  }

  private replaceDefaultChannels(profileId: string, channelIds: string[]): void {
    this.db.prepare('DELETE FROM profile_channels WHERE profile_id = ?').run(profileId)
    const exists = this.db.prepare('SELECT 1 FROM channels WHERE id = ?')
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO profile_channels (profile_id, channel_id) VALUES (?, ?)'
    )
    for (const channelId of channelIds) {
      if (exists.get(channelId)) {
        insert.run(profileId, channelId)
      }
    }
  }
}
