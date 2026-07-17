/**
 * Tiny `CallToolResult` builders shared by every tool-registration module
 * (register-send-tools.ts, register-config-tools.ts). A handler must never
 * throw -- one bad call would crash the whole stdio process or fail the
 * whole Streamable HTTP request for the client using it -- so every failure
 * path returns `errorResult` instead.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] }
}

export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
