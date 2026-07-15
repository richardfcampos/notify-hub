/**
 * MCP stdio entrypoint (spec MCP-04). A thin client of the already-running
 * gateway: reads NOTIFY_URL/NOTIFY_TOKEN from the environment (fail-fast,
 * mirrors the Claude Code hook client + AD-007) and serves the tools from
 * `buildMcpServer` over stdio. Never writes to stdout -- that's the MCP
 * wire protocol's channel -- so all diagnostics go to stderr only.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer } from '../mcp/mcp-server.js'

async function main(): Promise<void> {
  const notifyUrl = process.env.NOTIFY_URL
  const token = process.env.NOTIFY_TOKEN

  if (!notifyUrl) {
    console.error('mcp: missing required environment variable NOTIFY_URL')
    process.exit(1)
  }
  if (!token) {
    console.error('mcp: missing required environment variable NOTIFY_TOKEN')
    process.exit(1)
  }

  const server = buildMcpServer({ notifyUrl, token })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('mcp: notify-hub MCP server connected over stdio')
}

main().catch((error) => {
  console.error('mcp: failed to start', error)
  process.exit(1)
})
