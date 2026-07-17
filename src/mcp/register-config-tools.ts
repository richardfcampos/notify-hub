/**
 * MCP config management tools (spec MCPC-01..04), mounted ONLY on the
 * Streamable HTTP endpoint (src/admin/routes/mcp-route.ts) -- config tools
 * need direct DB access via the admin server's repositories, which a stdio
 * client never has. Every mutating tool reuses the exact same
 * config-validation.ts rules the admin `PUT /api/config` route uses
 * (../admin/config-service.ts), and `test_channel`/`get_status` reuse the
 * same orchestration as the admin panel's test-send/status routes
 * (../admin/test-send-service.ts, ../admin/status-service.ts) -- one source
 * of truth per behavior, never duplicated between the panel and MCP.
 *
 * Every failure is an `isError: true` result naming the exact problem
 * (id/key), and no repository write happens on any validation failure
 * (spec AC MCPC-02..04). `get_config` returns secrets in full -- same trust
 * model as the panel's GET /api/config (spec assumption "Secrets over MCP").
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AdminServerDeps } from '../admin/admin-server-deps.js'
import {
  channelInstanceSchema,
  deleteChannelEntity,
  deleteProfileEntity,
  getFullConfig,
  profileRecordSchema,
  upsertChannelEntity,
  upsertProfileEntity
} from '../admin/config-service.js'
import { getStatusSummary } from '../admin/status-service.js'
import { runTestSend } from '../admin/test-send-service.js'
import { errorResult, textResult } from './tool-result.js'

const idSchema = { id: z.string().min(1) }

export function registerConfigTools(server: McpServer, deps: AdminServerDeps): void {
  server.registerTool(
    'get_config',
    {
      title: 'Get config',
      description: 'Return every channel instance and profile from the database, including secrets.'
    },
    async () => textResult(JSON.stringify(getFullConfig(deps)))
  )

  server.registerTool(
    'upsert_channel',
    {
      title: 'Upsert channel',
      description:
        'Create or update a channel instance. Fails without writing anything if the id is not a valid slug, the type is unknown, or the channel is enabled but missing a required config key.',
      inputSchema: channelInstanceSchema.shape
    },
    async (args) => {
      const result = upsertChannelEntity(deps, args)
      if (!result.ok) {
        return errorResult(result.error)
      }
      return textResult(`Channel "${result.value.id}" saved.`)
    }
  )

  server.registerTool(
    'delete_channel',
    {
      title: 'Delete channel',
      description: 'Delete a channel instance by id and prune it from every profile that referenced it as a default.',
      inputSchema: idSchema
    },
    async ({ id }) => {
      const result = deleteChannelEntity(deps, id)
      if (!result.ok) {
        return errorResult(result.error)
      }
      return textResult(`Channel "${id}" deleted.`)
    }
  )

  server.registerTool(
    'upsert_profile',
    {
      title: 'Upsert profile',
      description:
        'Create or update a token profile. Fails without writing anything if a default channel does not exist or is not enabled, or if the token is already used by another profile.',
      inputSchema: profileRecordSchema.shape
    },
    async (args) => {
      const result = upsertProfileEntity(deps, args)
      if (!result.ok) {
        return errorResult(result.error)
      }
      return textResult(`Profile "${result.value.id}" saved.`)
    }
  )

  server.registerTool(
    'delete_profile',
    {
      title: 'Delete profile',
      description: 'Delete a token profile by id.',
      inputSchema: idSchema
    },
    async ({ id }) => {
      const result = deleteProfileEntity(deps, id)
      if (!result.ok) {
        return errorResult(result.error)
      }
      return textResult(`Profile "${id}" deleted.`)
    }
  )

  server.registerTool(
    'test_channel',
    {
      title: 'Test channel',
      description: 'Send a real test notification through the gateway targeting one channel instance and report the actual worker delivery outcome.',
      inputSchema: { channelId: z.string().min(1) }
    },
    async ({ channelId }) => {
      const outcome = await runTestSend(deps, channelId)
      if (outcome.kind !== 'result') {
        return errorResult(outcome.message)
      }
      if (!outcome.ok) {
        return errorResult(outcome.detail)
      }
      return textResult(outcome.detail)
    }
  )

  server.registerTool(
    'get_status',
    {
      title: 'Get status',
      description: 'Return gateway health, the channel list, and recent worker deliveries -- the same data as the admin panel status view.'
    },
    async () => textResult(JSON.stringify(await getStatusSummary(deps)))
  )
}
