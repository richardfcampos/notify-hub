/**
 * POST /mcp on the admin Fastify server (spec MCPC-05, MCPC-06): Streamable
 * HTTP transport, stateless mode (`sessionIdGenerator: undefined` -- the
 * installed SDK's simplest, horizontally-scalable mode; single trusted
 * client, the mcp-manager gateway -- spec assumption "Transport mode"). A
 * fresh `McpServer` + transport is built per request (the SDK's own
 * stateless pattern, verified against the installed
 * `@modelcontextprotocol/sdk@1.29.0`'s
 * `src/examples/server/simpleStatelessStreamableHttp.ts`): no session state
 * to leak between unrelated calls. `reply.hijack()` hands the raw Node
 * response to the SDK transport so Fastify never tries to also send its own
 * reply. GET/DELETE aren't meaningful without a session, so both 405 per
 * the SDK's own example. No auth on this endpoint by design (spec
 * "Out of Scope": same trust boundary as the panel -- the gateway's own
 * consumer-token layer is the access control).
 */
import type { FastifyInstance } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildAdminMcpServer } from '../../mcp/build-admin-mcp-server.js'
import type { AdminServerDeps } from '../admin-server-deps.js'

function methodNotAllowedBody(): { jsonrpc: '2.0'; error: { code: number; message: string }; id: null } {
  return { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }
}

export function registerMcpRoute(app: FastifyInstance, deps: AdminServerDeps): void {
  app.post('/mcp', async (request, reply) => {
    const server = buildAdminMcpServer(deps)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    reply.hijack()
    reply.raw.on('close', () => {
      transport.close()
      server.close()
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(request.raw, reply.raw, request.body)
    } catch (error) {
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' })
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: `Internal server error: ${error instanceof Error ? error.message : String(error)}` },
            id: null
          })
        )
      }
    }
  })

  app.get('/mcp', async (_request, reply) => {
    return reply.code(405).send(methodNotAllowedBody())
  })

  app.delete('/mcp', async (_request, reply) => {
    return reply.code(405).send(methodNotAllowedBody())
  })
}
