/**
 * POST /api/apply (ADMIN-04): runs `docker compose up -d` via the injected
 * CommandRunner from the repo root (the admin process's cwd) and reports
 * the outcome. 200 on exit code 0, 500 with stderr otherwise -- the UI
 * shows the command output either way (AC ADMIN-Save&Apply.3).
 */
import type { FastifyInstance } from 'fastify'
import type { AdminServerDeps } from '../admin-server-deps.js'

export function registerApplyRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.post('/api/apply', async (_request, reply) => {
    if (!deps.commandRunner) {
      return reply.code(500).send({ ok: false, output: 'admin server misconfigured: no CommandRunner provided' })
    }

    const result = await deps.commandRunner.run('docker', ['compose', 'up', '-d'], { cwd: process.cwd() })

    if (result.code === 0) {
      return reply.code(200).send({ ok: true, output: result.stdout })
    }
    return reply.code(500).send({ ok: false, output: result.stderr })
  })
}
