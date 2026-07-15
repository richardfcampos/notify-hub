/**
 * POST /api/apply (ADMIN-04, scoped by ADMIN-08.2): runs
 * `docker compose up -d --no-build api worker` via the injected
 * CommandRunner from `deps.composeDir` (falls back to the admin process's
 * own cwd) and reports the outcome. 200 on exit code 0, 500 with stderr
 * otherwise -- the UI shows the command output either way (AC
 * ADMIN-Save&Apply.3).
 *
 * Scoped to exactly `api worker` -- NEVER include the `admin` service
 * itself. When this route runs inside the dockerized admin container,
 * recreating the admin service mid-request would kill the container (and
 * this in-flight response) before the client ever sees it.
 */
import type { FastifyInstance } from 'fastify'
import type { AdminServerDeps } from '../admin-server-deps.js'

export function registerApplyRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.post('/api/apply', async (_request, reply) => {
    if (!deps.commandRunner) {
      return reply.code(500).send({ ok: false, output: 'admin server misconfigured: no CommandRunner provided' })
    }

    const result = await deps.commandRunner.run('docker', ['compose', 'up', '-d', '--no-build', 'api', 'worker'], {
      cwd: deps.composeDir ?? process.cwd()
    })

    if (result.code === 0) {
      return reply.code(200).send({ ok: true, output: result.stdout })
    }
    return reply.code(500).send({ ok: false, output: result.stderr })
  })
}
