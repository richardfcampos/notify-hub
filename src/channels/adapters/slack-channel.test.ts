/**
 * Tests derive from spec AC NOTIF-08 (POST to configured incoming
 * webhook) and T8's "Done when": exact webhook payload via
 * FakeHttpClient; non-2xx throws.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { SlackChannel, slackRegistryEntry } from './slack-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('SlackChannel', () => {
  it('POSTs the configured webhook with a bold-title text payload', async () => {
    const http = new FakeHttpClient()
    const channel = new SlackChannel(
      { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/x' },
      makeDeps(http)
    )

    await channel.send({ title: 'Build finished', message: 'All tests passed' })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://hooks.slack.com/services/x',
        headers: { 'content-type': 'application/json' },
        body: { text: '*Build finished*\nAll tests passed' }
      }
    ])
  })

  it('throws when the webhook responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 404, body: 'no_service' })
    const channel = new SlackChannel(
      { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/x' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/slack/i)
  })

  it('propagates a transport-level failure', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('connection reset'))
    const channel = new SlackChannel(
      { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/x' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('connection reset')
  })

  it('registers the required webhook URL config', () => {
    expect(slackRegistryEntry.requiredConfig).toEqual(['SLACK_WEBHOOK_URL'])
  })
})
