/**
 * FileStore port (ADMIN-03): the seam the admin panel uses to read/write
 * the gateway's `.env` file. `NodeEnvFileStore` is the real fs-backed impl;
 * tests use an in-memory fake (test/helpers/fakes.ts `FakeFileStore`) so no
 * real file ever touches disk during the suite.
 *
 * Write is atomic (write to a sibling tmp file, then rename -- rename is
 * atomic on POSIX filesystems, so a crash mid-write never leaves a
 * half-written `.env`). `backup()` copies the CURRENT on-disk content to a
 * timestamped sibling before any write happens, matching the convention
 * already used by scripts/setup-env.sh.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Clock } from '../core/ports.js'

/** Seam for reading/writing the `.env` file the admin panel edits. */
export interface FileStore {
  /** Current file content, or null when the file does not exist yet. */
  read(): Promise<string | null>
  /** Atomically overwrites the file with `content` (tmp write + rename). */
  write(content: string): Promise<void>
  /**
   * Copies the CURRENT on-disk content to a timestamped `.backup.<ts>`
   * sibling file. Returns the backup path, or null when there was nothing
   * to back up (file does not exist yet).
   */
  backup(): Promise<string | null>
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

/** `YYYYMMDDHHMMSS` in local time, matching scripts/setup-env.sh's `date +%Y%m%d%H%M%S`. */
function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

export class NodeEnvFileStore implements FileStore {
  constructor(
    private readonly path: string,
    private readonly clock: Clock = { now: () => Date.now() }
  ) {}

  async read(): Promise<string | null> {
    try {
      return await readFile(this.path, 'utf8')
    } catch (error) {
      if (isEnoent(error)) {
        return null
      }
      throw error
    }
  }

  async write(content: string): Promise<void> {
    const dir = dirname(this.path)
    const tmpPath = join(dir, `.env.tmp.${process.pid}.${this.clock.now()}`)
    await writeFile(tmpPath, content, { mode: 0o600 })
    await rename(tmpPath, this.path)
  }

  async backup(): Promise<string | null> {
    const current = await this.read()
    if (current === null) {
      return null
    }
    const backupPath = `${this.path}.backup.${formatTimestamp(this.clock.now())}`
    await writeFile(backupPath, current, { mode: 0o600 })
    return backupPath
  }
}
