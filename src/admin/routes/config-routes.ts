/**
 * GET/PUT /api/config (ADMIN-02, ADMIN-03). GET returns the parsed
 * AdminConfig as-is -- secrets included in full, since the trust boundary
 * is "runs on 127.0.0.1" (spec assumption), not the wire. PUT validates
 * before touching disk: an invalid body writes NOTHING (edge case /
 * AC ADMIN-03.2) and the channel/profile validation error names the
 * offending channel + key (or profile + channel) so the operator can fix
 * it, mirroring the gateway's own fail-fast message style.
 */
import type { FastifyInstance } from 'fastify'
import { parseAdminConfig, serializeAdminConfig, type AdminConfig } from '../admin-config.js'
import { validateAdminConfig } from '../admin-validation.js'
import type { AdminServerDeps } from '../admin-server-deps.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Minimal structural check on the PUT body -- enough to safely treat it as an AdminConfig before validation/serialization run. Malformed shape -> 400, nothing written. */
function isAdminConfigShape(body: unknown): body is AdminConfig {
  if (!isPlainObject(body)) {
    return false
  }
  if (!isPlainObject(body.channels) || !isPlainObject(body.extraKeys)) {
    return false
  }
  if (!Array.isArray(body.profiles)) {
    return false
  }
  return body.profiles.every(
    (p) =>
      isPlainObject(p) &&
      typeof p.name === 'string' &&
      typeof p.token === 'string' &&
      Array.isArray(p.defaultChannels)
  )
}

export function registerConfigRoutes(app: FastifyInstance, deps: AdminServerDeps): void {
  app.get('/api/config', async (_request, reply) => {
    const raw = await deps.fileStore.read()
    const cfg = parseAdminConfig(raw, deps.registry)
    return reply.code(200).send(cfg)
  })

  app.put('/api/config', async (request, reply) => {
    if (!isAdminConfigShape(request.body)) {
      return reply.code(400).send({ error: 'invalid request body: expected an AdminConfig object' })
    }

    const cfg = request.body
    const validation = validateAdminConfig(cfg, deps.registry)
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error })
    }

    const backupPath = await deps.fileStore.backup()
    await deps.fileStore.write(serializeAdminConfig(cfg, deps.registry))

    return reply.code(200).send({ ok: true, backupPath })
  })
}
