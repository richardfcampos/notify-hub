/**
 * Tests derive from spec AC NOTIF-09 (POST to configured incoming
 * webhook) and T9's "Done when": exact webhook payload via
 * FakeHttpClient; non-2xx throws.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { DiscordChannel, discordRegistryEntry } from './discord-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('DiscordChannel', () => {
  it('POSTs the configured webhook with a bold-title content payload', async () => {
    const http = new FakeHttpClient()
    const channel = new DiscordChannel(
      { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x' },
      makeDeps(http)
    )

    await channel.send({ title: 'Build finished', message: 'All tests passed' })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://discord.com/api/webhooks/x',
        headers: { 'content-type': 'application/json' },
        body: { content: '**Build finished**\nAll tests passed' }
      }
    ])
  })

  it('throws when the webhook responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 500, body: 'internal error' })
    const channel = new DiscordChannel(
      { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/discord/i)
  })

  it('propagates a transport-level failure', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('dns lookup failed'))
    const channel = new DiscordChannel(
      { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('dns lookup failed')
  })

  it('registers the required webhook URL config and a 2000 maxLength', () => {
    expect(discordRegistryEntry.requiredConfig).toEqual(['DISCORD_WEBHOOK_URL'])
    expect(discordRegistryEntry.maxLength).toBe(2000)
  })
})
