/**
 * Tests derive from spec AC NOTIF-16.2 and T24's "Done when": POSTs the
 * full Notification as JSON to the configured URL (asserted on field
 * values via FakeHttpClient); non-2xx throws.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { WebhookChannel, webhookRegistryEntry } from './webhook-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('WebhookChannel', () => {
  it('POSTs the full notification as JSON to the configured URL', async () => {
    const http = new FakeHttpClient()
    const channel = new WebhookChannel(
      { WEBHOOK_URL: 'https://example.com/hooks/notify' },
      makeDeps(http)
    )

    await channel.send({
      title: 'Build finished',
      message: 'All tests passed',
      priority: 'high',
      tags: ['ci'],
      metadata: { event: 'end', project: 'notify-hub' }
    })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://example.com/hooks/notify',
        headers: { 'content-type': 'application/json' },
        body: {
          title: 'Build finished',
          message: 'All tests passed',
          priority: 'high',
          tags: ['ci'],
          metadata: { event: 'end', project: 'notify-hub' }
        }
      }
    ])
  })

  it('omits optional fields when the notification does not set them', async () => {
    const http = new FakeHttpClient()
    const channel = new WebhookChannel(
      { WEBHOOK_URL: 'https://example.com/hooks/notify' },
      makeDeps(http)
    )

    await channel.send({ title: 't', message: 'm' })

    expect(http.calls[0].body).toEqual({
      title: 't',
      message: 'm',
      priority: undefined,
      tags: undefined,
      metadata: undefined
    })
  })

  it('throws when the endpoint responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 500, body: 'server_error' })
    const channel = new WebhookChannel(
      { WEBHOOK_URL: 'https://example.com/hooks/notify' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/webhook/i)
  })

  it('propagates a transport-level failure', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('connection reset'))
    const channel = new WebhookChannel(
      { WEBHOOK_URL: 'https://example.com/hooks/notify' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('connection reset')
  })

  it('registers the required webhook URL config', () => {
    expect(webhookRegistryEntry.requiredConfig).toEqual(['WEBHOOK_URL'])
  })
})
