/**
 * GET/PUT /api/config, DB-backed (spec DBCH-08, tasks.md D9). GET returns
 * the full desired-state shape straight from the repositories -- secrets
 * included in full, since the trust boundary is "runs on 127.0.0.1" (spec
 * assumption), not the wire. PUT treats the body as the COMPLETE desired
 * state: it validates everything first (nothing is written on any failure --
 * see ../config-validation.ts) and then applies a diff against the current
 * DB (upsert everything in the payload, delete rows absent from it -- that's
 * how the panel's "Delete" button takes effect). No `docker compose apply`
 * step: the change is live for the very next request/delivery (AD-018).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requiredConfigByChannel } from '../../channels/channel-registry.js'
import { validateConfigPayload, type ConfigPayload } from '../config-validation.js'
import type { AdminServerDeps } from '../admin-server-deps.js'

const channelInstanceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string())
})

const profileRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  token: z.string().min(1),
  defaultChannels: z.array(z.string())
})

const configPayloadSchema = z.object({
  channels: z.array(channelInstanceSchema),
  profiles: z.array(profileRecordSchema)
})

/** Deletes every existing row whose id is absent from the payload's ids -- the panel's Delete button. */
function idsToDelete(existingIds: string[], payloadIds: Iterable<string>): string[] {
  const kept = new Set(payloadIds)
  return existingIds.filter((id) => !kept.has(id))
}

export function registerConfigRoutes(app: FastifyInstance, deps: AdminServerDeps): void {
  app.get('/api/config', async (_request, reply) => {
    return reply.code(200).send({
      channels: deps.channelRepo.list(),
      profiles: deps.profileRepo.list()
    })
  })

  app.put('/api/config', async (request, reply) => {
    const parsed = configPayloadSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid request body: expected { channels: ChannelInstance[], profiles: ProfileRecord[] }' })
    }

    const payload: ConfigPayload = parsed.data
    const validation = validateConfigPayload(payload, requiredConfigByChannel)
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error })
    }

    const existingChannelIds = deps.channelRepo.list().map((c) => c.id)
    const existingProfileIds = deps.profileRepo.list().map((p) => p.id)

    for (const channel of payload.channels) {
      deps.channelRepo.upsert(channel)
    }
    for (const profile of payload.profiles) {
      deps.profileRepo.upsert(profile)
    }
    for (const id of idsToDelete(existingProfileIds, payload.profiles.map((p) => p.id))) {
      deps.profileRepo.delete(id)
    }
    for (const id of idsToDelete(existingChannelIds, payload.channels.map((c) => c.id))) {
      deps.channelRepo.delete(id)
    }

    return reply.code(200).send({ ok: true })
  })
}
