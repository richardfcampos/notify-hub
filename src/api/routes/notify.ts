/**
 * POST /notify (spec NOTIF-01). Bearer-authenticated: validate body ->
 * build a Notification -> enqueue a single DispatchJob -> 202 { jobId }.
 * 400 on an invalid body (naming the problem), 401 handled by the auth
 * preHandler (nothing enqueued), 503 if the queue is unreachable at
 * enqueue time (so the caller never hangs). The dispatch worker does the
 * per-channel fan-out later; this route only produces one job.
 */
import type { FastifyInstance } from 'fastify'
import type { DispatchJob, Notification } from '../../core/types.js'
import { createAuthPreHandler } from '../plugins/auth.js'
import { buildNotifySchema } from '../schemas/notify-schema.js'
import type { ServerDeps } from '../server.js'

export function registerNotifyRoute(app: FastifyInstance, deps: ServerDeps): void {
  const schema = buildNotifySchema()
  const authPreHandler = createAuthPreHandler(deps.profileRepo)

  app.post('/notify', { preHandler: authPreHandler }, async (request, reply) => {
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'invalid request body'
      return reply.code(400).send({ error: message })
    }

    const profile = request.profile
    if (!profile) {
      // Unreachable: the auth preHandler either sets profile or already replied 401.
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const body = parsed.data

    // Fail early: every requested channel must be an EXISTING instance id.
    // (Existence, not enablement -- a disabled instance is still a known id;
    // the dispatcher decides enablement.) An unknown id 400s, naming it.
    if (body.channels) {
      for (const id of body.channels) {
        if (!deps.channelRepo.get(id)) {
          return reply.code(400).send({ error: `unknown channel "${id}"` })
        }
      }
    }
    const notification: Notification = {
      title: body.title ?? 'Notification',
      message: body.message,
      priority: body.priority,
      tags: body.tags,
      metadata: body.metadata
    }

    const dedupKey =
      typeof body.metadata?.dedupKey === 'string' ? body.metadata.dedupKey : undefined

    const dispatchJob: DispatchJob = {
      notification,
      profileId: profile.id,
      profileName: profile.name,
      requestedChannels: body.channels,
      dedupKey
    }

    try {
      const { jobId } = await deps.queue.enqueueDispatch(dispatchJob)
      return reply.code(202).send({ jobId })
    } catch (error) {
      deps.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'enqueueDispatch failed; returning 503'
      )
      return reply.code(503).send({ error: 'notification queue unavailable' })
    }
  })
}
