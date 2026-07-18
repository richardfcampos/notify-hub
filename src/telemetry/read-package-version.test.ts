import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPackageVersion } from './read-package-version.js'

describe('readPackageVersion', () => {
  it('reads the real version field from the repo package.json', () => {
    const raw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')
    const expected = (JSON.parse(raw) as { version: string }).version

    expect(readPackageVersion()).toBe(expected)
  })
})
