/**
 * Tests derive from spec AC NOTIF-05.1 (publish with title/message/
 * priority/tags) and T5's "Done when": exact URL/headers/body asserted
 * via FakeHttpClient; a non-2xx response and a transport-level failure
 * (e.g. timeout) both throw.
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

describe('NtfyChannel', () => {
  it('publishes to NTFY_URL/topic with title, priority and tags headers, plain-text body', async () => {
    const http = new FakeHttpClient()
    const channel = new NtfyChannel(
      { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'my-topic' },
      makeDeps(http)
    )

    await channel.send({
      title: 'Build finished',
      message: 'All tests passed',
      priority: 'high',
      tags: ['ci', 'success']
    })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://ntfy.sh/my-topic',
        headers: {
          Title: 'Build finished',
          Priority: 'high',
          Tags: 'ci,success'
        },
        body: 'All tests passed'
      }
    ])
  })

  it('omits Priority and Tags headers when not provided', async () => {
    const http = new FakeHttpClient()
    const channel = new NtfyChannel(
      { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'my-topic' },
      makeDeps(http)
    )

    await channel.send({ title: 't', message: 'm' })

    expect(http.calls[0].headers).toEqual({ Title: 't' })
  })

  it('throws when ntfy responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 500, body: 'server error' })
    const channel = new NtfyChannel(
      { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'my-topic' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/ntfy/i)
  })

  it('propagates a transport-level failure (e.g. timeout)', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('request timed out'))
    const channel = new NtfyChannel(
      { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'my-topic' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('request timed out')
  })

  it('registers the required NTFY_URL and NTFY_TOPIC config keys', () => {
    expect(ntfyRegistryEntry.requiredConfig).toEqual(['NTFY_URL', 'NTFY_TOPIC'])
  })
})
