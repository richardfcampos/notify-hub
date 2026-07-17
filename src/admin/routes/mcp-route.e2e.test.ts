/**
 * e2e proving the Streamable HTTP endpoint actually serves MCP (spec
 * MCPC-05, MCPC-06): unlike every other admin route test (Fastify
 * `app.inject`, no socket), this one needs a REAL listener -- the official
 * SDK client's `StreamableHTTPClientTransport` speaks real HTTP, not
 * Fastify's injection protocol. `startAdminServer(deps, { port: 0 })` lets
 * the OS pick a free ephemeral port (same pattern as
 * admin-server.e2e.test.ts's binding tests) so this test never collides
 * with anything already listening.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { FakeChannelRepository, FakeHttpClient, FakeProfileRepository } from '../../../test/helpers/fakes.js'
import type { ChannelInstance } from '../../core/types.js'
import { startAdminServer, type AdminServerDeps } from '../admin-server.js'

function channel(over: Partial<ChannelInstance> & { id: string }): ChannelInstance {
  return { label: over.id, type: 'ntfy', enabled: true, config: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' }, ...over }
}

let app: FastifyInstance | null = null
let client: Client | null = null

afterEach(async () => {
  if (client) {
    await client.close()
    client = null
  }
  if (app) {
    await app.close()
    app = null
  }
})

async function startAndConnect(overrides: Partial<AdminServerDeps> = {}): Promise<{
  client: Client
  channelRepo: FakeChannelRepository
  profileRepo: FakeProfileRepository
  http: FakeHttpClient
}> {
  const channelRepo = (overrides.channelRepo as FakeChannelRepository) ?? new FakeChannelRepository()
  const profileRepo = (overrides.profileRepo as FakeProfileRepository) ?? new FakeProfileRepository()
  const http = (overrides.http as FakeHttpClient) ?? new FakeHttpClient()
  const deps: AdminServerDeps = { channelRepo, profileRepo, http, ...overrides }

  app = await startAdminServer(deps, { port: 0 })
  const address = app.server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const url = new URL(`http://127.0.0.1:${port}/mcp`)

  const transport = new StreamableHTTPClientTransport(url)
  const sdkClient = new Client({ name: 'e2e-test-client', version: '0.0.0' })
  await sdkClient.connect(transport)
  client = sdkClient

  return { client: sdkClient, channelRepo, profileRepo, http }
}

describe('POST /mcp (Streamable HTTP)', () => {
  it('serves initialize/tools-list over real HTTP with all 10 tools (3 send + 7 config)', async () => {
    const { client } = await startAndConnect()

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_gateway_health',
      'delete_channel',
      'delete_profile',
      'get_config',
      'get_status',
      'list_channels',
      'send_notification',
      'test_channel',
      'upsert_channel',
      'upsert_profile'
    ])
  })

  it('round-trips get_config against the seeded repositories', async () => {
    const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy' })])
    const profileRepo = new FakeProfileRepository([
      { id: 'acme', name: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] }
    ])
    const { client } = await startAndConnect({ channelRepo, profileRepo })

    const result = await client.callTool({ name: 'get_config', arguments: {} })

    const content = result.content as Array<{ type: string; text?: string }>
    expect(JSON.parse(content[0]?.text ?? '')).toEqual({
      channels: [channel({ id: 'acme-ntfy' })],
      profiles: [{ id: 'acme', name: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] }]
    })
  })

  it('upsert_channel writes through to the repository read by the rest of the admin server', async () => {
    const { client, channelRepo } = await startAndConnect()

    const result = await client.callTool({ name: 'upsert_channel', arguments: channel({ id: 'acme-ntfy' }) })

    expect(result.isError).toBeFalsy()
    expect(channelRepo.get('acme-ntfy')).toEqual(channel({ id: 'acme-ntfy' }))
  })

  it('a send tool (send_notification) goes through the admin server HttpClient, asserting the exact gateway request', async () => {
    const profileRepo = new FakeProfileRepository([
      { id: 'phone', name: 'phone', token: 'tok-phone', defaultChannels: [] }
    ])
    const { client, http } = await startAndConnect({ profileRepo })
    http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'job-1' }) })

    const result = await client.callTool({ name: 'send_notification', arguments: { message: 'hi' } })

    expect(result.isError).toBeFalsy()
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0].method).toBe('POST')
    expect(http.calls[0].url).toBe('http://localhost:8080/notify')
    expect(http.calls[0].headers?.authorization).toBe('Bearer tok-phone')
    expect(http.calls[0].body).toEqual({ message: 'hi' })
  })
})

describe('GET/DELETE /mcp', () => {
  it('405s a GET (no session to resume in stateless mode)', async () => {
    const channelRepo = new FakeChannelRepository()
    const profileRepo = new FakeProfileRepository()
    app = await startAdminServer({ channelRepo, profileRepo }, { port: 0 })
    const address = app.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' })

    expect(res.status).toBe(405)
  })

  it('405s a DELETE (no session to terminate in stateless mode)', async () => {
    const channelRepo = new FakeChannelRepository()
    const profileRepo = new FakeProfileRepository()
    app = await startAdminServer({ channelRepo, profileRepo }, { port: 0 })
    const address = app.server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'DELETE' })

    expect(res.status).toBe(405)
  })
})
