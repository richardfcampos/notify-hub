/**
 * Reads this package's own version from package.json at runtime (TEL-01
 * payload field `version`). Resolves the path relative to THIS module's own
 * compiled location (mirrors src/bin/admin.ts's uiDir resolution) so it
 * works identically via `tsx` from src/telemetry/ and as compiled
 * dist/telemetry/ -- both sit exactly two directories below the repo root.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = resolve(here, '../../package.json')

interface PackageJson {
  version: string
}

/** Reads package.json fresh on every call -- it's a tiny file read once per
 * process boot, so there is no need to cache the result. */
export function readPackageVersion(): string {
  const raw = readFileSync(packageJsonPath, 'utf-8')
  const parsed = JSON.parse(raw) as PackageJson
  return parsed.version
}
