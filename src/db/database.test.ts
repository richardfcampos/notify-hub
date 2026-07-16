/**
 * Tests derive from spec DBCH-01 + Edge Cases: WAL + busy_timeout applied,
 * schema created idempotently, and the DB file (and its parent dirs) are
 * created on first open. Uses a real temp directory per test -- no mocking
 * of fs/sqlite -- so the on-disk behavior is genuinely exercised.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notify-hub-db-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('creates the db file and missing parent directories on first open', () => {
    const dbPath = join(dir, 'nested', 'sub', 'notify-hub.db')

    const db = openDatabase(dbPath)
    db.close()

    expect(existsSync(dbPath)).toBe(true)
  })

  it('creates channels, profiles and profile_channels tables', () => {
    const db = openDatabase(join(dir, 'notify-hub.db'))

    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tableNames).toEqual(['channels', 'profile_channels', 'profiles'])
    db.close()
  })

  it('enables WAL journal mode', () => {
    const db = openDatabase(join(dir, 'notify-hub.db'))

    const mode = db.pragma('journal_mode', { simple: true })

    expect(mode).toBe('wal')
    db.close()
  })

  it('enables foreign key enforcement', () => {
    const db = openDatabase(join(dir, 'notify-hub.db'))

    const enforced = db.pragma('foreign_keys', { simple: true })

    expect(enforced).toBe(1)
    db.close()
  })

  it('sets the busy timeout pragma', () => {
    const db = openDatabase(join(dir, 'notify-hub.db'))

    const timeout = db.pragma('busy_timeout', { simple: true })

    expect(timeout).toBe(5000)
    db.close()
  })

  it('opening the same path twice is idempotent (schema + data survive re-open)', () => {
    const dbPath = join(dir, 'notify-hub.db')

    const first = openDatabase(dbPath)
    first
      .prepare(
        'INSERT INTO channels (id, label, type, enabled, config, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('acme-slack', 'Acme Slack', 'slack', 1, '{}', new Date().toISOString())
    first.close()

    const second = openDatabase(dbPath)
    const row = second.prepare('SELECT id, label FROM channels WHERE id = ?').get('acme-slack')
    second.close()

    expect(row).toEqual({ id: 'acme-slack', label: 'Acme Slack' })
  })

  it('supports an in-memory database (no file created)', () => {
    const db = openDatabase(':memory:')

    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)

    expect(tableNames).toEqual(['channels', 'profile_channels', 'profiles'])
    db.close()
  })
})
