/**
 * SQLite bootstrap (DBCH-01). Opens (creating the file + any missing parent
 * directories on first boot) the single on-disk database shared by api and
 * worker, applies pragmas for safe concurrent access -- WAL journaling so
 * readers never block a writer, a short busy timeout so a momentary lock
 * contention errors that one read/write instead of hanging, and foreign
 * key enforcement so `ON DELETE CASCADE` actually cascades -- then runs the
 * idempotent schema (see ./schema-sql.ts). Safe to call more than once
 * against the same path (api + worker each open their own handle).
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_SQL } from './schema-sql.js'

/** Busy timeout (ms) applied to every connection before it gives up on a lock. */
export const BUSY_TIMEOUT_MS = 5000

/**
 * Opens the SQLite database at `path` (or `:memory:`), applies pragmas, and
 * idempotently creates the schema. Throws if the underlying directory
 * cannot be created or the file cannot be opened (bad permissions,
 * corrupt file, etc.) -- callers should let that crash the process at boot
 * rather than run with a half-initialized store.
 */
export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') {
    const dir = dirname(path)
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)

  return db
}
