/**
 * SQLite-backed ChannelRepository (DBCH-02). Persists named channel
 * instances; `config` is stored as a JSON string column and the boolean
 * `enabled` as 0/1. `upsert` inserts or updates in place on the id primary
 * key (never a duplicate row); `delete` cascades to profile_channels via
 * the foreign key. Read at delivery time so panel edits hot-reload.
 */
import type Database from 'better-sqlite3'
import type { ChannelRepository } from '../core/ports.js'
import type { ChannelInstance } from '../core/types.js'

interface ChannelRow {
  id: string
  label: string
  type: string
  enabled: number
  config: string
}

function rowToInstance(row: ChannelRow): ChannelInstance {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    enabled: row.enabled === 1,
    config: JSON.parse(row.config) as Record<string, string>
  }
}

const SELECT_COLS = 'SELECT id, label, type, enabled, config FROM channels'

export class SqliteChannelRepository implements ChannelRepository {
  constructor(private readonly db: Database.Database) {}

  list(): ChannelInstance[] {
    const rows = this.db
      .prepare(`${SELECT_COLS} ORDER BY created_at, id`)
      .all() as ChannelRow[]
    return rows.map(rowToInstance)
  }

  listEnabled(): ChannelInstance[] {
    const rows = this.db
      .prepare(`${SELECT_COLS} WHERE enabled = 1 ORDER BY created_at, id`)
      .all() as ChannelRow[]
    return rows.map(rowToInstance)
  }

  get(id: string): ChannelInstance | null {
    const row = this.db
      .prepare(`${SELECT_COLS} WHERE id = ?`)
      .get(id) as ChannelRow | undefined
    return row ? rowToInstance(row) : null
  }

  upsert(channel: ChannelInstance): void {
    this.db
      .prepare(
        `INSERT INTO channels (id, label, type, enabled, config, created_at)
         VALUES (@id, @label, @type, @enabled, @config, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           type = excluded.type,
           enabled = excluded.enabled,
           config = excluded.config`
      )
      .run({
        id: channel.id,
        label: channel.label,
        type: channel.type,
        enabled: channel.enabled ? 1 : 0,
        config: JSON.stringify(channel.config ?? {}),
        created_at: new Date().toISOString()
      })
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(id)
  }
}
