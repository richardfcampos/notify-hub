/**
 * Exact URL/headers/body asserted via FakeHttpClient; a non-2xx response
 * and a transport-level failure (e.g. timeout) both throw. The UTF-8
 * regression test pins the JSON publish format: emoji/accents must ride
 * in the JSON body, never in HTTP headers (headers are Latin-1 only and
 * made real sends crash before this format was adopted).
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { NtfyChannel, ntfyRegistryEntry } from './ntfy-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

function makeChannel(http: FakeHttpClient): NtfyChannel {
  return new NtfyChannel(
    { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'my-topic' },
    makeDeps(http)
  )
}

describe('NtfyChannel', () => {
  it('publishes JSON to the server root with topic, title, message, numeric priority and tags in the body', async () => {
    const http = new FakeHttpClient()
    const channel = makeChannel(http)

    await channel.send({
      title: 'Build finished',
      message: 'All tests passed',
      priority: 'high',
      tags: ['ci', 'success']
    })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://ntfy.sh',
        headers: { 'content-type': 'application/json' },
        body: {
          topic: 'my-topic',
          title: 'Build finished',
          message: 'All tests passed',
          priority: 4,
          tags: ['ci', 'success']
        }
      }
    ])
  })

  it('maps every priority level to its ntfy integer', async () => {
    const cases: Array<[string, number]> = [
      ['low', 2],
      ['default', 3],
      ['high', 4],
      ['urgent', 5]
    ]
    for (const [priority, expected] of cases) {
      const http = new FakeHttpClient()
      await makeChannel(http).send({
        title: 't',
        message: 'm',
        priority: priority as 'low' | 'default' | 'high' | 'urgent'
      })
      expect((http.calls[0].body as Record<string, unknown>).priority).toBe(
        expected
      )
    }
  })

  it('keeps emoji and accents intact in the JSON body and never puts them in headers (UTF-8 regression)', async () => {
    const http = new FakeHttpClient()
    const channel = makeChannel(http)

    await channel.send({
      title: 'notify-hub ✅',
      message: 'Notificação de teste — chegou! 🎉',
      tags: ['tada']
    })

    const call = http.calls[0]
    expect(call.body).toEqual({
      topic: 'my-topic',
      title: 'notify-hub ✅',
      message: 'Notificação de teste — chegou! 🎉',
      tags: ['tada']
    })
    // Headers must stay pure ASCII -- non-Latin-1 header values crash fetch.
    for (const [key, value] of Object.entries(call.headers ?? {})) {
      expect(`${key}${value}`).toMatch(/^[\x20-\x7e]*$/)
    }
  })

  it('omits priority and tags from the body when not provided', async () => {
    const http = new FakeHttpClient()
    const channel = makeChannel(http)

    await channel.send({ title: 't', message: 'm' })

    expect(http.calls[0].body).toEqual({
      topic: 'my-topic',
      title: 't',
      message: 'm'
    })
  })

  it('throws when ntfy responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 500, body: 'server error' })
    const channel = makeChannel(http)

    await expect(channel.send({ title: 't', message: 'm' })).rejects.toThrow(
      /ntfy/i
    )
  })

  it('propagates a transport-level failure (e.g. timeout)', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('request timed out'))
    const channel = makeChannel(http)

    await expect(channel.send({ title: 't', message: 'm' })).rejects.toThrow(
      'request timed out'
    )
  })

  it('registers the required NTFY_URL and NTFY_TOPIC config keys', () => {
    expect(ntfyRegistryEntry.requiredConfig).toEqual(['NTFY_URL', 'NTFY_TOPIC'])
  })
})
