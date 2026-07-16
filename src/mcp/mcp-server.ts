/**
 * MCP stdio server (spec MCP-01, MCP-02, MCP-03, MCP-05; AD-012): a thin
 * client of the already-running gateway HTTP API -- it never touches the
 * queue/Redis directly. All three tools call `${notifyUrl}` through the
 * injected `fetchImpl` (defaults to global `fetch`), which is the seam
 * tests replace to assert exact requests without a network. Gateway
 * non-2xx responses and network failures are converted to `isError: true`
 * results; a handler here must never throw, or one bad call would crash
 * the whole stdio process for the agent using it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

export interface BuildMcpServerOptions {
  notifyUrl: string
  token: string
  fetchImpl?: typeof fetch
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parses a 2xx gateway body; malformed JSON becomes an error result rather than a thrown exception. */
function parseGatewayBody<T>(bodyText: string): { ok: true; value: T } | { ok: false; result: CallToolResult } {
  try {
    return { ok: true, value: JSON.parse(bodyText) as T }
  } catch (error) {
    return { ok: false, result: errorResult(`Gateway returned an unparseable response: ${failureMessage(error)}`) }
  }
}

export function buildMcpServer(opts: BuildMcpServerOptions): McpServer {
  const fetchImpl = opts.fetchImpl ?? fetch
  const authHeader = `Bearer ${opts.token}`

  const server = new McpServer({ name: 'notify-hub', version: '0.1.0' })

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
        response = await fetchImpl(`${opts.notifyUrl}/notify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: authHeader },
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
        response = await fetchImpl(`${opts.notifyUrl}/channels`, {
          method: 'GET',
          headers: { authorization: authHeader }
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
        response = await fetchImpl(`${opts.notifyUrl}/health`, { method: 'GET' })
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

  return server
}
