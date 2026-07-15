/**
 * Hand-rolled static file serving for the admin dashboard UI (ADMIN-01,
 * ADMIN-07). Deliberately not @fastify/static: the whole UI is a handful of
 * files served from a single directory, so a small catch-all GET route is
 * simpler to reason about and test than adding + configuring a plugin
 * dependency. Fastify's router (find-my-way) matches static routes like
 * `/api/config` before a `/*` wildcard, so this can be registered alongside
 * the JSON API routes safely regardless of order.
 */
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

const INDEX_FILE = 'admin.html'

/** Registers a `GET /*` route serving files from `uiDir`, defaulting `/` to admin.html. Rejects any resolved path escaping `uiDir` (403). */
export function registerStaticUiRoutes(app: FastifyInstance, uiDir: string): void {
  const root = resolve(uiDir)

  app.get('/*', async (request, reply) => {
    const requested = (request.params as Record<string, string>)['*'] ?? ''
    const relative = requested === '' ? INDEX_FILE : requested
    const filePath = resolve(root, relative)

    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return reply.code(403).send({ error: 'forbidden' })
    }

    try {
      const content = await readFile(filePath)
      const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream'
      return reply.code(200).header('content-type', contentType).send(content)
    } catch {
      return reply.code(404).send({ error: 'not found' })
    }
  })
}
