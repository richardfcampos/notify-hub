/**
 * SQLite schema (DBCH-01). Every statement is idempotent (`IF NOT EXISTS`)
 * so `openDatabase` can run this on every boot -- first boot creates the
 * tables, later boots are a no-op -- without a separate migration runner.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_channels (
  profile_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, channel_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);
`
