/**
 * MCP stdio server (spec MCP-01, MCP-02, MCP-03, MCP-05; AD-012). Registers
 * ONLY the send toolset -- config management lives exclusively on the
 * Streamable HTTP endpoint (src/admin/routes/mcp-route.ts) since the
 * gateway's own token is the only credential a stdio client presents, with
 * no equivalent of the admin panel's DB access. Tool implementations live in
 * register-send-tools.ts, shared with the HTTP endpoint so stdio and HTTP
 * send behavior can never drift (MCPC-06).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSendTools } from './register-send-tools.js'

export interface BuildMcpServerOptions {
  notifyUrl: string
  token: string
  fetchImpl?: typeof fetch
}

export function buildMcpServer(opts: BuildMcpServerOptions): McpServer {
  const server = new McpServer({ name: 'notify-hub', version: '0.1.0' })
  registerSendTools(server, { gatewayBaseUrl: opts.notifyUrl, token: opts.token, fetchImpl: opts.fetchImpl })
  return server
}
