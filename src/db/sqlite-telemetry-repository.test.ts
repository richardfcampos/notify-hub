/**
 * Tests derive from spec TEL-01 AC6 + TEL-02: the anonymous install UUID is
 * generated once, persists across re-opens of the SAME db file, and is
 * genuinely random (not a hardcoded fallback) -- proven by two independent
 * fresh db files producing DIFFERENT ids. Real temp-file SQLite, no mocking.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database.js'
import { getOrCreateInstallId } from './sqlite-telemetry-repository.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notify-hub-telemetry-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('getOrCreateInstallId', () => {
  it('creates and returns a UUID on a fresh database', () => {
    const db = openDatabase(join(dir, 'notify-hub.db'))

    const installId = getOrCreateInstallId(db)

    expect(installId).toMatch(UUID_PATTERN)
    db.close()
  })

  it('returns the identical id on a second call against the same open db', () => {
    const db = openDatabase(join(dir, 'notify-hub.db'))

    const first = getOrCreateInstallId(db)
    const second = getOrCreateInstallId(db)

    expect(second).toBe(first)
    db.close()
  })

  it('returns the identical id after closing and reopening the same file', () => {
    const dbPath = join(dir, 'notify-hub.db')

    const first = openDatabase(dbPath)
    const firstId = getOrCreateInstallId(first)
    first.close()

    const second = openDatabase(dbPath)
    const secondId = getOrCreateInstallId(second)
    second.close()

    expect(secondId).toBe(firstId)
  })

  it('produces different ids for two different fresh database files (proves real randomness)', () => {
    const dbA = openDatabase(join(dir, 'a.db'))
    const dbB = openDatabase(join(dir, 'b.db'))

    const idA = getOrCreateInstallId(dbA)
    const idB = getOrCreateInstallId(dbB)

    expect(idA).not.toBe(idB)
    dbA.close()
    dbB.close()
  })
})
