/**
 * e2e via `app.inject` with FakeCommandRunner (ADMIN-04, scoped by
 * ADMIN-08.2). Derived from spec P1 "Save & Apply pipeline" AC1/AC3 and the
 * Amendment 1 constraint: success reports the command output, failure
 * reports the stderr output instead of throwing, and the command is scoped
 * to exactly `api worker` -- never the admin service itself, and never
 * `--build` (compose already builds images out of band).
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

function makeApp(overrides: Partial<AdminServerDeps> = {}): {
  app: FastifyInstance
  commandRunner: FakeCommandRunner
} {
  const commandRunner = (overrides.commandRunner as FakeCommandRunner) ?? new FakeCommandRunner()
  const deps: AdminServerDeps = { fileStore: new FakeFileStore(), registry, commandRunner, ...overrides }
  return { app: buildAdminServer(deps), commandRunner }
}

describe('POST /api/apply', () => {
  it('runs `docker compose up -d --no-build api worker` from cwd and returns 200 + stdout on success', async () => {
    const { app, commandRunner } = makeApp()
    current = app
    commandRunner.queueResult({ code: 0, stdout: 'Container notify-hub-worker-1  Started', stderr: '' })

    const res = await app.inject({ method: 'POST', url: '/api/apply' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, output: 'Container notify-hub-worker-1  Started' })
    expect(commandRunner.calls).toEqual([
      { cmd: 'docker', args: ['compose', 'up', '-d', '--no-build', 'api', 'worker'], opts: { cwd: process.cwd() } }
    ])
  })

  it('runs the compose command from the injected composeDir instead of the bare process cwd (ADMIN-08.3)', async () => {
    const { app, commandRunner } = makeApp({ composeDir: '/config' })
    current = app
    commandRunner.queueResult({ code: 0, stdout: '', stderr: '' })

    await app.inject({ method: 'POST', url: '/api/apply' })

    expect(commandRunner.calls).toEqual([
      { cmd: 'docker', args: ['compose', 'up', '-d', '--no-build', 'api', 'worker'], opts: { cwd: '/config' } }
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
