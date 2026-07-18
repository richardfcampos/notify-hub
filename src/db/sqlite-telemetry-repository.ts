/**
 * SQLite-backed anonymous install id (TEL-02). A single row keyed by the
 * literal id 'singleton' stores a random UUID generated once on first boot;
 * every later call reads that same row back unchanged so telemetry
 * heartbeats carry a stable (but never identity-derived: no hostname/IP/MAC)
 * distinctId across restarts.
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

const SINGLETON_ID = 'singleton'

interface TelemetryRow {
  install_id: string
}

/**
 * Returns the persisted anonymous install UUID, generating and persisting
 * one on first call. Never regenerates once a row exists.
 */
export function getOrCreateInstallId(db: Database.Database): string {
  const existing = db
    .prepare('SELECT install_id FROM telemetry WHERE id = ?')
    .get(SINGLETON_ID) as TelemetryRow | undefined

  if (existing) {
    return existing.install_id
  }

  const installId = randomUUID()
  db.prepare('INSERT INTO telemetry (id, install_id) VALUES (?, ?)').run(SINGLETON_ID, installId)
  return installId
}
