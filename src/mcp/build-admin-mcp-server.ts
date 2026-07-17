/**
 * Builds the `McpServer` exposed on the admin Streamable HTTP endpoint
 * (spec MCPC-05, MCPC-06): the send toolset (register-send-tools.ts) PLUS
 * the config management toolset (register-config-tools.ts) on one
 * registration, so a single MCP client sees both (one registration covers
 * configure + send). The send tools speak through the SAME `HttpClient`
 * port every other admin route uses (../admin/admin-server-deps.ts) --
 * never a bare `fetch` -- so tests can substitute `FakeHttpClient` for the
 * whole endpoint, panel and MCP alike. The token is resolved live from
 * `ProfileRepository` on every call (the "first profile's token"
 * convention shared with test-send/status), matching the admin panel's
 * hot-reload behavior. A fresh server is built per request (see
 * ../admin/routes/mcp-route.ts) -- the stateless Streamable HTTP pattern.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AdminServerDeps } from '../admin/admin-server-deps.js'
import { buildGatewayContext } from '../admin/gateway-client.js'
import type { HttpClient } from '../core/ports.js'
import { registerConfigTools } from './register-config-tools.js'
import { registerSendTools } from './register-send-tools.js'

/**
 * Adapts the admin server's `HttpClient` port to a `fetch`-compatible
 * function so register-send-tools.ts -- written once against `fetch` for
 * the stdio transport -- works unmodified here too. Missing `HttpClient`
 * (server misconfigured) throws, which register-send-tools.ts already
 * catches and turns into an `isError` result naming the failure.
 */
function httpClientAsFetch(http: HttpClient | undefined): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    if (!http) {
      throw new Error('admin server misconfigured: no HttpClient provided')
    }
    const url = typeof input === 'string' ? input : input.toString()
    const headers = init.headers as Record<string, string> | undefined
    let body: unknown
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    const res = await http.request({ method: init.method ?? 'GET', url, headers, body })
    return new Response(res.body, { status: res.status })
  }) as typeof fetch
}

export function buildAdminMcpServer(deps: AdminServerDeps): McpServer {
  const server = new McpServer({ name: 'notify-hub', version: '0.1.0' })
  registerConfigTools(server, deps)
  registerSendTools(server, {
    gatewayBaseUrl: buildGatewayContext(undefined, deps.gatewayBaseUrl).baseUrl,
    token: () => deps.profileRepo.list()[0]?.token,
    fetchImpl: httpClientAsFetch(deps.http)
  })
  return server
}
