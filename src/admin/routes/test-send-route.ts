/**
 * POST /api/test-send { channel } (ADMIN-05): validates the channel is
 * enabled, sends a real test notification to the running gateway, then
 * polls the worker's delivery logs for a result for that channel newer
 * than the send -- proving delivery end-to-end instead of just "enqueued".
 * Gateway down/timeout -> `{ok:false, detail}` fast (AC ADMIN-05.3), never
 * a hang: the poll loop is bounded (`testSendPollAttempts`) and its delay
 * is injectable so tests run instantly instead of the ~10s real total.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseAdminConfig } from '../admin-config.js'
import type { AdminServerDeps } from '../admin-server-deps.js'
import { buildGatewayContext, sendTestNotification } from '../gateway-client.js'
import { fetchWorkerDeliveryEvents } from '../worker-logs.js'

const DEFAULT_POLL_ATTEMPTS = 10
const DEFAULT_POLL_INTERVAL_MS = 1000

const bodySchema = z.object({ channel: z.string().min(1, 'channel is required') })

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function registerTestSendRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.post('/api/test-send', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid request body' })
    }
    const { channel } = parsed.data

    if (!(channel in deps.registry)) {
      return reply.code(400).send({ error: `unknown channel "${channel}"` })
    }

    const raw = await deps.fileStore.read()
    const cfg = parseAdminConfig(raw, deps.registry)
    if (!cfg.channels[channel]?.enabled) {
      return reply.code(400).send({ error: `channel "${channel}" is not enabled` })
    }

    if (!deps.http) {
      return reply.code(500).send({ error: 'admin server misconfigured: no HttpClient provided' })
    }

    const gatewayContext = buildGatewayContext(cfg)
    const sentAt = Date.now()

    const notifyOutcome = await sendTestNotification(deps.http, gatewayContext, channel)
    if (!notifyOutcome.ok) {
      return reply.code(200).send({ ok: false, detail: `gateway unreachable: ${notifyOutcome.errorMessage}` })
    }

    if (!deps.commandRunner) {
      return reply
        .code(200)
        .send({ ok: false, detail: 'no CommandRunner configured to observe the delivery outcome' })
    }

    const attempts = deps.testSendPollAttempts ?? DEFAULT_POLL_ATTEMPTS
    const intervalMs = deps.testSendPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const delay = deps.delay ?? realDelay

    for (let attempt = 0; attempt < attempts; attempt++) {
      const events = await fetchWorkerDeliveryEvents(deps.commandRunner, process.cwd())
      const match = events
        .filter((event) => event.channel === channel && (!event.time || Date.parse(event.time) >= sentAt))
        .at(-1)

      if (match) {
        return reply.code(200).send({ ok: match.ok, detail: match.ok ? 'sent' : (match.error ?? 'delivery failed') })
      }

      if (attempt < attempts - 1) {
        await delay(intervalMs)
      }
    }

    return reply.code(200).send({ ok: false, detail: 'no delivery result observed within timeout' })
  })
}
