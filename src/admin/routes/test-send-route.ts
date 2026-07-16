/**
 * POST /api/test-send { channelId } (ADMIN-05, rewired to named channel
 * INSTANCES by tasks.md D9): validates the instance exists and is enabled
 * (via ChannelRepository -- no more type-registry membership check, since
 * instances are looked up by id directly), sends a real test notification to
 * the running gateway using the first profile's token (ProfileRepository),
 * then polls the worker's delivery logs for a result for that instance id
 * newer than the send -- proving delivery end-to-end instead of just
 * "enqueued". Gateway down/timeout -> `{ok:false, detail}` fast (AC
 * ADMIN-05.3), never a hang: the poll loop is bounded
 * (`testSendPollAttempts`) and its delay is injectable so tests run
 * instantly instead of the ~10s real total.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AdminServerDeps } from '../admin-server-deps.js'
import { buildGatewayContext, sendTestNotification } from '../gateway-client.js'
import { fetchWorkerDeliveryEvents } from '../worker-logs.js'

const DEFAULT_POLL_ATTEMPTS = 10
const DEFAULT_POLL_INTERVAL_MS = 1000

const bodySchema = z.object({ channelId: z.string().min(1, 'channelId is required') })

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function registerTestSendRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.post('/api/test-send', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid request body' })
    }
    const { channelId } = parsed.data

    const channel = deps.channelRepo.get(channelId)
    if (!channel) {
      return reply.code(400).send({ error: `unknown channel "${channelId}"` })
    }
    if (!channel.enabled) {
      return reply.code(400).send({ error: `channel "${channelId}" is not enabled` })
    }

    if (!deps.http) {
      return reply.code(500).send({ error: 'admin server misconfigured: no HttpClient provided' })
    }

    const token = deps.profileRepo.list()[0]?.token
    const gatewayContext = buildGatewayContext(token, deps.gatewayBaseUrl)
    const sentAt = Date.now()

    const notifyOutcome = await sendTestNotification(deps.http, gatewayContext, channelId)
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
      const events = await fetchWorkerDeliveryEvents(deps.commandRunner, deps.composeDir ?? process.cwd())
      const match = events
        .filter((event) => event.channel === channelId && (!event.time || Date.parse(event.time) >= sentAt))
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
