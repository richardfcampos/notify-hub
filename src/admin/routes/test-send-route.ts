/**
 * POST /api/test-send { channelId } (ADMIN-05, rewired to named channel
 * INSTANCES by tasks.md D9). Thin HTTP mapping over the shared
 * `runTestSend` orchestration (../test-send-service.ts, also used by the MCP
 * `test_channel` tool) -- this file's only job is parsing the request body
 * and mapping the outcome kind to the right status code.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AdminServerDeps } from '../admin-server-deps.js'
import { runTestSend } from '../test-send-service.js'

const bodySchema = z.object({ channelId: z.string().min(1, 'channelId is required') })

export function registerTestSendRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.post('/api/test-send', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid request body' })
    }

    const outcome = await runTestSend(deps, parsed.data.channelId)
    switch (outcome.kind) {
      case 'not_found':
      case 'disabled':
        return reply.code(400).send({ error: outcome.message })
      case 'misconfigured':
        return reply.code(500).send({ error: outcome.message })
      case 'result':
        return reply.code(200).send({ ok: outcome.ok, detail: outcome.detail })
    }
  })
}
