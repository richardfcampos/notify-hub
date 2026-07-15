/**
 * Tests derive from spec AC NOTIF-06.2 (send via Bot API sendMessage to
 * the configured chat_id) and T6's "Done when": exact URL/payload via
 * FakeHttpClient; non-2xx throws.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { TelegramChannel, telegramRegistryEntry } from './telegram-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('TelegramChannel', () => {
  it('POSTs sendMessage with the bot token in the URL and chat_id/text in the JSON body', async () => {
    const http = new FakeHttpClient()
    const channel = new TelegramChannel(
      { TELEGRAM_BOT_TOKEN: 'bot123', TELEGRAM_CHAT_ID: '456' },
      makeDeps(http)
    )

    await channel.send({ title: 'Build finished', message: 'All tests passed' })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.telegram.org/botbot123/sendMessage',
        headers: { 'content-type': 'application/json' },
        body: { chat_id: '456', text: 'Build finished\nAll tests passed' }
      }
    ])
  })

  it('throws when Telegram responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 400, body: 'Bad Request' })
    const channel = new TelegramChannel(
      { TELEGRAM_BOT_TOKEN: 'bot123', TELEGRAM_CHAT_ID: '456' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/telegram/i)
  })

  it('propagates a transport-level failure', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('network unreachable'))
    const channel = new TelegramChannel(
      { TELEGRAM_BOT_TOKEN: 'bot123', TELEGRAM_CHAT_ID: '456' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('network unreachable')
  })

  it('registers the required bot token/chat id config and a 4096 maxLength', () => {
    expect(telegramRegistryEntry.requiredConfig).toEqual([
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHAT_ID'
    ])
    expect(telegramRegistryEntry.maxLength).toBe(4096)
  })
})
