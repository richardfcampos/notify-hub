/**
 * e2e via `app.inject` with FakeCommandRunner (ADMIN-04). Derived from
 * spec P1 "Save & Apply pipeline" AC1/AC3: success reports the command
 * output, failure reports the stderr output instead of throwing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { FakeCommandRunner, FakeFileStore } from '../../../test/helpers/fakes.js'
import { buildAdminServer, type AdminServerDeps } from '../admin-server.js'
import type { ChannelSchema } from '../admin-config.js'

const registry: Record<string, ChannelSchema> = { ntfy: { requiredConfig: ['NTFY_URL', 'NTFY_TOPIC'] } }

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

function makeApp(commandRunner?: FakeCommandRunner): { app: FastifyInstance; commandRunner: FakeCommandRunner } {
  const runner = commandRunner ?? new FakeCommandRunner()
  const deps: AdminServerDeps = { fileStore: new FakeFileStore(), registry, commandRunner: runner }
  return { app: buildAdminServer(deps), commandRunner: runner }
}

describe('POST /api/apply', () => {
  it('runs `docker compose up -d` from cwd and returns 200 + stdout on success', async () => {
    const { app, commandRunner } = makeApp()
    current = app
    commandRunner.queueResult({ code: 0, stdout: 'Container notify-hub-worker-1  Started', stderr: '' })

    const res = await app.inject({ method: 'POST', url: '/api/apply' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, output: 'Container notify-hub-worker-1  Started' })
    expect(commandRunner.calls).toEqual([
      { cmd: 'docker', args: ['compose', 'up', '-d'], opts: { cwd: process.cwd() } }
    ])
  })

  it('returns 500 + stderr output when the compose command fails', async () => {
    const { app, commandRunner } = makeApp()
    current = app
    commandRunner.queueResult({ code: 1, stdout: '', stderr: 'no configuration file provided' })

    const res = await app.inject({ method: 'POST', url: '/api/apply' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ ok: false, output: 'no configuration file provided' })
  })

  it('returns 500 when no CommandRunner is configured, without crashing', async () => {
    const deps: AdminServerDeps = { fileStore: new FakeFileStore(), registry }
    const app = buildAdminServer(deps)
    current = app

    const res = await app.inject({ method: 'POST', url: '/api/apply' })

    expect(res.statusCode).toBe(500)
    expect(res.json().ok).toBe(false)
  })
})
