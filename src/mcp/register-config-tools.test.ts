/**
 * Unit tests for the MCP config tool surface (spec MCPC-01..04). A real SDK
 * `Client` talks to an `McpServer` carrying `registerConfigTools` over an
 * in-memory transport pair (no HTTP listener, no stdio, no Docker) with fake
 * repositories/http/command-runner, so every assertion is on the exact
 * result text/isError a tool returns AND on repository state afterward
 * (nothing-persisted-on-failure).
 */
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  FakeChannelRepository,
  FakeCommandRunner,
  FakeHttpClient,
  FakeProfileRepository
} from '../../test/helpers/fakes.js'
import type { AdminServerDeps } from '../admin/admin-server-deps.js'
import type { ChannelInstance, ProfileRecord } from '../core/types.js'
import { registerConfigTools } from './register-config-tools.js'

function channel(over: Partial<ChannelInstance> & { id: string }): ChannelInstance {
  return { label: over.id, type: 'ntfy', enabled: true, config: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' }, ...over }
}

function profile(over: Partial<ProfileRecord> & { id: string; token: string }): ProfileRecord {
  return { name: over.id, defaultChannels: [], ...over }
}

async function connectedClient(deps: AdminServerDeps): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  registerConfigTools(server, deps)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>
  return content[0]?.text ?? ''
}

describe('registerConfigTools', () => {
  it('registers exactly the seven config tools', async () => {
    const client = await connectedClient({ channelRepo: new FakeChannelRepository(), profileRepo: new FakeProfileRepository() })

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name).sort()).toEqual([
      'delete_channel',
      'delete_profile',
      'get_config',
      'get_status',
      'test_channel',
      'upsert_channel',
      'upsert_profile'
    ])
  })

  describe('get_config', () => {
    it('returns every channel and profile from the repositories, secrets included', async () => {
      const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy' })])
      const profileRepo = new FakeProfileRepository([profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })])
      const client = await connectedClient({ channelRepo, profileRepo })

      const result = await client.callTool({ name: 'get_config', arguments: {} })

      expect(result.isError).toBeFalsy()
      expect(JSON.parse(firstText(result))).toEqual({
        channels: [channel({ id: 'acme-ntfy' })],
        profiles: [profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })]
      })
    })
  })

  describe('upsert_channel', () => {
    it('persists a valid new channel', async () => {
      const channelRepo = new FakeChannelRepository()
      const client = await connectedClient({ channelRepo, profileRepo: new FakeProfileRepository() })

      const result = await client.callTool({
        name: 'upsert_channel',
        arguments: channel({ id: 'acme-ntfy' })
      })

      expect(result.isError).toBeFalsy()
      expect(firstText(result)).toContain('acme-ntfy')
      expect(channelRepo.list()).toEqual([channel({ id: 'acme-ntfy' })])
    })

    it('updates an existing channel in place', async () => {
      const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy', label: 'Old' })])
      const client = await connectedClient({ channelRepo, profileRepo: new FakeProfileRepository() })

      const result = await client.callTool({
        name: 'upsert_channel',
        arguments: channel({ id: 'acme-ntfy', label: 'New' })
      })

      expect(result.isError).toBeFalsy()
      expect(channelRepo.list()).toEqual([channel({ id: 'acme-ntfy', label: 'New' })])
    })

    it('rejects an invalid slug id, naming it, and persists nothing', async () => {
      const channelRepo = new FakeChannelRepository()
      const client = await connectedClient({ channelRepo, profileRepo: new FakeProfileRepository() })

      const result = await client.callTool({
        name: 'upsert_channel',
        arguments: channel({ id: 'Not A Slug' })
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('"Not A Slug"')
      expect(channelRepo.list()).toEqual([])
    })

    it('rejects an unknown type, naming it, and persists nothing', async () => {
      const channelRepo = new FakeChannelRepository()
      const client = await connectedClient({ channelRepo, profileRepo: new FakeProfileRepository() })

      const result = await client.callTool({
        name: 'upsert_channel',
        arguments: channel({ id: 'acme-x', type: 'carrier-pigeon' })
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('Channel "acme-x" has unknown type "carrier-pigeon"')
      expect(channelRepo.list()).toEqual([])
    })

    it('rejects an enabled channel missing required config, naming instance + key, and persists nothing', async () => {
      const channelRepo = new FakeChannelRepository()
      const client = await connectedClient({ channelRepo, profileRepo: new FakeProfileRepository() })

      const result = await client.callTool({
        name: 'upsert_channel',
        arguments: channel({ id: 'acme-slack', type: 'slack', config: {} })
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('Channel "acme-slack" is enabled but missing required config "SLACK_WEBHOOK_URL"')
      expect(channelRepo.list()).toEqual([])
    })
  })

  describe('delete_channel', () => {
    it('deletes the instance and prunes it from every profile default', async () => {
      const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy' })])
      const profileRepo = new FakeProfileRepository([
        profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })
      ])
      const client = await connectedClient({ channelRepo, profileRepo })

      const result = await client.callTool({ name: 'delete_channel', arguments: { id: 'acme-ntfy' } })

      expect(result.isError).toBeFalsy()
      expect(channelRepo.list()).toEqual([])
      expect(profileRepo.get('acme')?.defaultChannels).toEqual([])
    })

    it('rejects an unknown id, naming it, and changes nothing', async () => {
      const channelRepo = new FakeChannelRepository([channel({ id: 'keep' })])
      const client = await connectedClient({ channelRepo, profileRepo: new FakeProfileRepository() })

      const result = await client.callTool({ name: 'delete_channel', arguments: { id: 'ghost' } })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('unknown channel "ghost"')
      expect(channelRepo.list()).toEqual([channel({ id: 'keep' })])
    })
  })

  describe('upsert_profile', () => {
    it('persists a valid new profile', async () => {
      const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy' })])
      const profileRepo = new FakeProfileRepository()
      const client = await connectedClient({ channelRepo, profileRepo })

      const result = await client.callTool({
        name: 'upsert_profile',
        arguments: profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })
      })

      expect(result.isError).toBeFalsy()
      expect(profileRepo.list()).toEqual([profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })])
    })

    it('rejects a default channel ref that does not exist, naming it, and persists nothing', async () => {
      const profileRepo = new FakeProfileRepository()
      const client = await connectedClient({ channelRepo: new FakeChannelRepository(), profileRepo })

      const result = await client.callTool({
        name: 'upsert_profile',
        arguments: profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['ghost'] })
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('Profile "acme" has default channel "ghost" which does not exist')
      expect(profileRepo.list()).toEqual([])
    })

    it('rejects a default channel ref that is disabled, naming it, and persists nothing', async () => {
      const channelRepo = new FakeChannelRepository([channel({ id: 'acme-ntfy', enabled: false })])
      const profileRepo = new FakeProfileRepository()
      const client = await connectedClient({ channelRepo, profileRepo })

      const result = await client.callTool({
        name: 'upsert_profile',
        arguments: profile({ id: 'acme', token: 'tok-acme', defaultChannels: ['acme-ntfy'] })
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('Profile "acme" has default channel "acme-ntfy" which is not enabled')
      expect(profileRepo.list()).toEqual([])
    })

    it('rejects a token already used by another profile, and persists nothing', async () => {
      const profileRepo = new FakeProfileRepository([profile({ id: 'existing', token: 'shared' })])
      const client = await connectedClient({ channelRepo: new FakeChannelRepository(), profileRepo })

      const result = await client.callTool({
        name: 'upsert_profile',
        arguments: profile({ id: 'new-guy', token: 'shared' })
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('Duplicate token for profile "new-guy"')
      expect(profileRepo.list()).toEqual([profile({ id: 'existing', token: 'shared' })])
    })
  })

  describe('delete_profile', () => {
    it('deletes the profile', async () => {
      const profileRepo = new FakeProfileRepository([profile({ id: 'acme', token: 'tok-acme' })])
      const client = await connectedClient({ channelRepo: new FakeChannelRepository(), profileRepo })

      const result = await client.callTool({ name: 'delete_profile', arguments: { id: 'acme' } })

      expect(result.isError).toBeFalsy()
      expect(profileRepo.list()).toEqual([])
    })

    it('rejects an unknown id, naming it, and changes nothing', async () => {
      const profileRepo = new FakeProfileRepository([profile({ id: 'keep', token: 'tok-keep' })])
      const client = await connectedClient({ channelRepo: new FakeChannelRepository(), profileRepo })

      const result = await client.callTool({ name: 'delete_profile', arguments: { id: 'ghost' } })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('unknown profile "ghost"')
      expect(profileRepo.list()).toEqual([profile({ id: 'keep', token: 'tok-keep' })])
    })
  })

  describe('test_channel', () => {
    function makeDeps(): { deps: AdminServerDeps; http: FakeHttpClient; commandRunner: FakeCommandRunner } {
      const http = new FakeHttpClient()
      const commandRunner = new FakeCommandRunner()
      const deps: AdminServerDeps = {
        channelRepo: new FakeChannelRepository([channel({ id: 'acme-ntfy' }), channel({ id: 'acme-slack', type: 'slack', enabled: false })]),
        profileRepo: new FakeProfileRepository([profile({ id: 'phone', token: 'tok-phone', defaultChannels: ['acme-ntfy'] })]),
        http,
        commandRunner,
        testSendPollAttempts: 3,
        testSendPollIntervalMs: 1,
        delay: async () => {}
      }
      return { deps, http, commandRunner }
    }

    it('reports the actual worker delivery outcome on success', async () => {
      const { deps, http, commandRunner } = makeDeps()
      http.queueResponse({ status: 202, body: JSON.stringify({ jobId: 'x' }) })
      commandRunner.queueResult({
        code: 0,
        stdout: `worker-1 | ${JSON.stringify({ time: Date.now() + 1000, channel: 'acme-ntfy', msg: 'notification sent' })}`,
        stderr: ''
      })
      const client = await connectedClient(deps)

      const result = await client.callTool({ name: 'test_channel', arguments: { channelId: 'acme-ntfy' } })

      expect(result.isError).toBeFalsy()
      expect(firstText(result)).toBe('sent')
    })

    it('rejects an unknown channel id', async () => {
      const { deps } = makeDeps()
      const client = await connectedClient(deps)

      const result = await client.callTool({ name: 'test_channel', arguments: { channelId: 'ghost' } })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('unknown channel "ghost"')
    })

    it('rejects a disabled channel id', async () => {
      const { deps } = makeDeps()
      const client = await connectedClient(deps)

      const result = await client.callTool({ name: 'test_channel', arguments: { channelId: 'acme-slack' } })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('channel "acme-slack" is not enabled')
    })

    it('reports an unreachable gateway as isError (edge case: gateway down)', async () => {
      const { deps, http } = makeDeps()
      http.queueError(new Error('ECONNREFUSED'))
      const client = await connectedClient(deps)

      const result = await client.callTool({ name: 'test_channel', arguments: { channelId: 'acme-ntfy' } })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toBe('gateway unreachable: ECONNREFUSED')
    })
  })

  describe('get_status', () => {
    it('returns gateway health, channels and recent deliveries -- the config tools still work while the gateway is down', async () => {
      const http = new FakeHttpClient()
      http.queueError(new Error('ECONNREFUSED'))
      http.queueError(new Error('ECONNREFUSED'))
      const deps: AdminServerDeps = {
        channelRepo: new FakeChannelRepository(),
        profileRepo: new FakeProfileRepository([profile({ id: 'phone', token: 'tok-phone' })]),
        http
      }
      const client = await connectedClient(deps)

      const result = await client.callTool({ name: 'get_status', arguments: {} })

      expect(result.isError).toBeFalsy()
      expect(JSON.parse(firstText(result))).toEqual({
        gateway: { up: false },
        channels: [],
        defaultChannels: [],
        recentDeliveries: []
      })
    })
  })
})
