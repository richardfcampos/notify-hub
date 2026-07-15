/**
 * Unit tests for the MCP tool surface (spec MCP-01, MCP-02, MCP-03, MCP-05).
 * A real SDK `Client` talks to `buildMcpServer()` over an in-memory
 * transport pair (no stdio, no process spawn) while a fake `fetch` stands
 * in for the gateway, so every assertion is on the exact request the tool
 * made (URL, auth header, body) and the exact result text/isError it
 * returned. Never touches the network (MCP-05).
 */
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildMcpServer } from './mcp-server.js'

const NOTIFY_URL = 'http://gateway.test'
const TOKEN = 'tok-test'

interface RecordedFetchCall {
  url: string
  init?: RequestInit
}

/** Records every fetch call and replays scripted Response/Error values in FIFO order. */
function fakeFetch(script: Array<Response | Error>): {
  fetchImpl: typeof fetch
  calls: RecordedFetchCall[]
} {
  const calls: RecordedFetchCall[] = []
  const queue = [...script]
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = queue.shift()
    if (next instanceof Error) {
      throw next
    }
    if (!next) {
      throw new Error('fakeFetch: no scripted response left')
    }
    return next
  }) as typeof fetch
  return { fetchImpl, calls }
}

async function connectedClient(fetchImpl: typeof fetch): Promise<Client> {
  const server = buildMcpServer({ notifyUrl: NOTIFY_URL, token: TOKEN, fetchImpl })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>
  return content[0]?.text ?? ''
}

describe('buildMcpServer', () => {
  it('registers exactly the three notify-hub tools', async () => {
    const { fetchImpl } = fakeFetch([])
    const client = await connectedClient(fetchImpl)

    const { tools } = await client.listTools()

    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_gateway_health',
      'list_channels',
      'send_notification'
    ])
  })

  describe('send_notification', () => {
    it('posts to /notify with the auth header and exact body, returning the jobId', async () => {
      const { fetchImpl, calls } = fakeFetch([
        new Response(JSON.stringify({ jobId: 'job-123' }), { status: 202 })
      ])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({
        name: 'send_notification',
        arguments: {
          message: 'hi',
          title: 'Build',
          priority: 'high',
          tags: ['ci'],
          channels: ['ntfy']
        }
      })

      expect(result.isError).toBeFalsy()
      expect(firstText(result)).toContain('job-123')

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(`${NOTIFY_URL}/notify`)
      expect(calls[0].init?.method).toBe('POST')
      const headers = calls[0].init?.headers as Record<string, string>
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`)
      expect(headers['content-type']).toBe('application/json')
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({
        message: 'hi',
        title: 'Build',
        priority: 'high',
        tags: ['ci'],
        channels: ['ntfy']
      })
    })

    it.each([400, 401, 503])(
      'surfaces a %i gateway response as isError without throwing',
      async (status) => {
        const { fetchImpl } = fakeFetch([
          new Response(JSON.stringify({ error: 'boom' }), { status })
        ])
        const client = await connectedClient(fetchImpl)

        const result = await client.callTool({
          name: 'send_notification',
          arguments: { message: 'hi' }
        })

        expect(result.isError).toBe(true)
        expect(firstText(result)).toContain(String(status))
        expect(firstText(result)).toContain('boom')
      }
    )

    it('surfaces an unreachable gateway as isError without throwing', async () => {
      const { fetchImpl } = fakeFetch([new TypeError('fetch failed')])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({
        name: 'send_notification',
        arguments: { message: 'hi' }
      })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('fetch failed')
    })
  })

  describe('list_channels', () => {
    it('GETs /channels with the auth header and returns the parsed lists', async () => {
      const { fetchImpl, calls } = fakeFetch([
        new Response(JSON.stringify({ channels: ['ntfy', 'telegram'], defaultChannels: ['ntfy'] }), {
          status: 200
        })
      ])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({ name: 'list_channels', arguments: {} })

      expect(result.isError).toBeFalsy()
      expect(firstText(result)).toContain('ntfy, telegram')
      expect(firstText(result)).toContain('Default channels for this token: ntfy')

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(`${NOTIFY_URL}/channels`)
      expect(calls[0].init?.method).toBe('GET')
      const headers = calls[0].init?.headers as Record<string, string>
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`)
    })

    it('surfaces a 401 gateway response as isError without throwing', async () => {
      const { fetchImpl } = fakeFetch([
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      ])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({ name: 'list_channels', arguments: {} })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('401')
      expect(firstText(result)).toContain('unauthorized')
    })

    it('surfaces an unreachable gateway as isError without throwing', async () => {
      const { fetchImpl } = fakeFetch([new TypeError('fetch failed')])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({ name: 'list_channels', arguments: {} })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('fetch failed')
    })
  })

  describe('check_gateway_health', () => {
    it('GETs /health and reflects status + redis', async () => {
      const { fetchImpl, calls } = fakeFetch([
        new Response(JSON.stringify({ status: 'ok', redis: true }), { status: 200 })
      ])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({ name: 'check_gateway_health', arguments: {} })

      expect(result.isError).toBeFalsy()
      expect(firstText(result)).toContain('Gateway status: ok, redis: true')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(`${NOTIFY_URL}/health`)
      expect(calls[0].init?.method).toBe('GET')
    })

    it('surfaces a 503 gateway response as isError without throwing', async () => {
      const { fetchImpl } = fakeFetch([
        new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
      ])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({ name: 'check_gateway_health', arguments: {} })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('503')
      expect(firstText(result)).toContain('unavailable')
    })

    it('surfaces an unreachable gateway as isError without throwing', async () => {
      const { fetchImpl } = fakeFetch([new TypeError('fetch failed')])
      const client = await connectedClient(fetchImpl)

      const result = await client.callTool({ name: 'check_gateway_health', arguments: {} })

      expect(result.isError).toBe(true)
      expect(firstText(result)).toContain('fetch failed')
    })
  })
})
