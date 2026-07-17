/**
 * The three notify-hub send tools (spec MCP-01, MCP-02, MCP-03, MCP-05;
 * AD-012; MCPC-06 shared toolset), extracted from mcp-server.ts so the same
 * registration function serves both the stdio transport (src/bin/mcp.ts)
 * and the Streamable HTTP endpoint (src/admin/routes/mcp-route.ts). Each
 * tool is a thin client of the already-running gateway HTTP API -- it never
 * touches the queue/Redis directly -- calling `${gatewayBaseUrl}` through
 * the injected `fetchImpl` (defaults to global `fetch`), which is the seam
 * tests replace to assert exact requests without a network.
 *
 * `token` accepts either a static string (stdio: one token for the whole
 * process, read once from the environment) or a resolver function called
 * per tool invocation (HTTP: the admin server's "first profile's token",
 * read live so a panel/MCP edit to profiles takes effect on the very next
 * call -- same hot-reload behavior as the rest of the admin surface). A
 * resolver returning `undefined` (no profile configured yet) omits the
 * Authorization header entirely rather than sending a literal
 * "Bearer undefined".
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { errorResult, failureMessage, textResult } from './tool-result.js'

export interface RegisterSendToolsOptions {
  gatewayBaseUrl: string
  token: string | (() => string | undefined)
  fetchImpl?: typeof fetch
}

function resolveToken(token: string | (() => string | undefined)): string | undefined {
  return typeof token === 'function' ? token() : token
}

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

/** Parses a 2xx gateway body; malformed JSON becomes an error result rather than a thrown exception. */
function parseGatewayBody<T>(bodyText: string): { ok: true; value: T } | { ok: false; result: ReturnType<typeof errorResult> } {
  try {
    return { ok: true, value: JSON.parse(bodyText) as T }
  } catch (error) {
    return { ok: false, result: errorResult(`Gateway returned an unparseable response: ${failureMessage(error)}`) }
  }
}

export function registerSendTools(server: McpServer, opts: RegisterSendToolsOptions): void {
  const fetchImpl = opts.fetchImpl ?? fetch

  server.registerTool(
    'send_notification',
    {
      title: 'Send notification',
      description: 'Send a push notification through the notify-hub gateway.',
      inputSchema: {
        message: z.string().min(1),
        title: z.string().optional(),
        priority: z.enum(['low', 'default', 'high', 'urgent']).optional(),
        tags: z.array(z.string()).optional(),
        channels: z.array(z.string()).optional()
      }
    },
    async (args) => {
      let response: Response
      try {
        response = await fetchImpl(`${opts.gatewayBaseUrl}/notify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(resolveToken(opts.token)) },
          body: JSON.stringify(args)
        })
      } catch (error) {
        return errorResult(`Failed to reach notify-hub gateway: ${failureMessage(error)}`)
      }

      const bodyText = await response.text()
      if (!response.ok) {
        return errorResult(`Gateway returned ${response.status}: ${bodyText}`)
      }

      const parsed = parseGatewayBody<{ jobId?: string }>(bodyText)
      if (!parsed.ok) {
        return parsed.result
      }
      return textResult(`Notification queued (jobId: ${parsed.value.jobId ?? 'unknown'})`)
    }
  )

  server.registerTool(
    'list_channels',
    {
      title: 'List channels',
      description:
        "List channels active on the notify-hub gateway and this token's default channels."
    },
    async () => {
      let response: Response
      try {
        response = await fetchImpl(`${opts.gatewayBaseUrl}/channels`, {
          method: 'GET',
          headers: authHeaders(resolveToken(opts.token))
        })
      } catch (error) {
        return errorResult(`Failed to reach notify-hub gateway: ${failureMessage(error)}`)
      }

      const bodyText = await response.text()
      if (!response.ok) {
        return errorResult(`Gateway returned ${response.status}: ${bodyText}`)
      }

      const parsed = parseGatewayBody<{
        channels: Array<{ id: string; label: string; type: string; enabled: boolean }>
        defaultChannels: string[]
      }>(bodyText)
      if (!parsed.ok) {
        return parsed.result
      }
      const lines = parsed.value.channels.map(
        (c) => `- ${c.label} (${c.id}) [${c.type}] ${c.enabled ? 'enabled' : 'disabled'}`
      )
      const listText = lines.length > 0 ? `\n${lines.join('\n')}` : ' (none configured)'
      return textResult(
        `Channel instances:${listText}\n` +
          `Default channels for this token: ${parsed.value.defaultChannels.join(', ')}`
      )
    }
  )

  server.registerTool(
    'check_gateway_health',
    {
      title: 'Check gateway health',
      description: 'Check whether the notify-hub gateway and its queue backend are reachable.'
    },
    async () => {
      let response: Response
      try {
        response = await fetchImpl(`${opts.gatewayBaseUrl}/health`, { method: 'GET' })
      } catch (error) {
        return errorResult(`Failed to reach notify-hub gateway: ${failureMessage(error)}`)
      }

      const bodyText = await response.text()
      if (!response.ok) {
        return errorResult(`Gateway returned ${response.status}: ${bodyText}`)
      }

      const parsed = parseGatewayBody<{ status: string; redis: boolean }>(bodyText)
      if (!parsed.ok) {
        return parsed.result
      }
      return textResult(`Gateway status: ${parsed.value.status}, redis: ${parsed.value.redis}`)
    }
  )
}
