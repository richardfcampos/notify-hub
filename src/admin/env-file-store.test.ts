/**
 * Tests derive from spec ADMIN-03 + Edge Cases: atomic write (tmp+rename),
 * timestamped backup naming, and "missing file -> null" (not a thrown
 * error). Uses a real temp directory (os.tmpdir()) -- no mocking of fs --
 * so the atomic-rename behavior is genuinely exercised.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NodeEnvFileStore } from './env-file-store.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'notify-hub-admin-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('NodeEnvFileStore', () => {
  it('read() returns null when the file does not exist yet (edge case)', async () => {
    const store = new NodeEnvFileStore(join(dir, '.env'))

    await expect(store.read()).resolves.toBeNull()
  })

  it('write() then read() round-trips content, and no leftover tmp file remains (atomic write)', async () => {
    const envPath = join(dir, '.env')
    const store = new NodeEnvFileStore(envPath)

    await store.write('PORT=8080\n')

    await expect(store.read()).resolves.toBe('PORT=8080\n')
    const entries = await readdir(dir)
    expect(entries).toEqual(['.env'])
  })

  it('write() overwrites existing content fully', async () => {
    const store = new NodeEnvFileStore(join(dir, '.env'))
    await store.write('PORT=8080\n')

    await store.write('PORT=9090\n')

    await expect(store.read()).resolves.toBe('PORT=9090\n')
  })

  it('backup() returns null and writes nothing when there is no existing file', async () => {
    const store = new NodeEnvFileStore(join(dir, '.env'))

    await expect(store.backup()).resolves.toBeNull()
    await expect(readdir(dir)).resolves.toEqual([])
  })

  it('backup() copies current content to a `<path>.backup.<timestamp>` sibling named from the injected clock', async () => {
    const envPath = join(dir, '.env')
    // 2026-07-15T09:05:03 local time -> YYYYMMDDHHMMSS
    const fixedDate = new Date(2026, 6, 15, 9, 5, 3)
    const store = new NodeEnvFileStore(envPath, { now: () => fixedDate.getTime() })
    await store.write('PORT=8080\n')

    const backupPath = await store.backup()

    expect(backupPath).toBe(`${envPath}.backup.20260715090503`)
    await expect(readFile(backupPath as string, 'utf8')).resolves.toBe('PORT=8080\n')
    // Original file is untouched by backup().
    await expect(store.read()).resolves.toBe('PORT=8080\n')
  })
})
