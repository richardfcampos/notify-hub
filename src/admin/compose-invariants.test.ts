/**
 * Test-asserted invariant from spec Amendment 1, revised ADMIN-01.2: the
 * dockerized admin service's host-side port mapping must stay pinned to
 * 127.0.0.1 (never LAN-reachable) even though the container listens on
 * 0.0.0.0 internally, and the compose project name must be pinned so
 * `docker compose` invoked from inside the admin container (against the
 * same bind-mounted directory, at a different path) manages this exact
 * stack instead of a duplicate one (ADMIN-08.2).
 *
 * Parses docker-compose.yml with plain text/regex rather than a YAML
 * parser dependency -- deliberately narrow (just the two asserted facts),
 * matching the file's actual 2-space-indent style rather than reimplementing
 * a general YAML reader.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const composePath = join(here, '../../docker-compose.yml')

function readCompose(): string {
  return readFileSync(composePath, 'utf8')
}

/**
 * Extracts the raw indented body of a top-level service (e.g. "admin")
 * from the `services:` section: everything after the `  <name>:` header
 * line up to (excluding) the next line at 2-space-or-less indentation
 * (a sibling service or another top-level key).
 */
function extractServiceBlock(yaml: string, serviceName: string): string {
  const lines = yaml.split('\n')
  const headerRe = new RegExp(`^ {2}${serviceName}:\\s*$`)
  const startIndex = lines.findIndex((line) => headerRe.test(line))
  if (startIndex === -1) {
    throw new Error(`service "${serviceName}" not found in docker-compose.yml`)
  }

  const blockLines: string[] = []
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^ {0,2}\S/.test(line)) {
      break
    }
    blockLines.push(line)
  }
  return blockLines.join('\n')
}

/** Extracts the scalar values of a 4-space-indented `<key>:` YAML list within a service block, skipping comment/blank lines and stripping surrounding quotes. */
function extractYamlListValues(serviceBlock: string, key: string): string[] {
  const lines = serviceBlock.split('\n')
  const keyRe = new RegExp(`^ {4}${key}:\\s*$`)
  const startIndex = lines.findIndex((line) => keyRe.test(line))
  if (startIndex === -1) {
    return []
  }

  const values: string[] = []
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const match = /^ {6}-\s*(.+)$/.exec(line)
    if (!match) {
      break
    }
    values.push(match[1].trim().replace(/^["']|["']$/g, ''))
  }
  return values
}

describe('docker-compose.yml invariants (spec Amendment 1, revised ADMIN-01.2 / ADMIN-08.2)', () => {
  it("pins the admin service's port mapping host-side to 127.0.0.1 (LAN-unreachable invariant)", () => {
    const adminBlock = extractServiceBlock(readCompose(), 'admin')
    const ports = extractYamlListValues(adminBlock, 'ports')

    expect(ports.length).toBeGreaterThan(0)
    for (const port of ports) {
      expect(port.startsWith('127.0.0.1:')).toBe(true)
    }
  })

  it('pins the top-level compose project name to "notify-hub" (no duplicate stack from inside the container)', () => {
    const match = /^name:\s*(\S+)\s*$/m.exec(readCompose())
    expect(match?.[1]).toBe('notify-hub')
  })
})
