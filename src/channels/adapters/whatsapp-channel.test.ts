/**
 * Exact CallMeBot GET request (urlencoded phone/text/apikey) asserted via
 * FakeHttpClient; non-2xx (incl. rate-limit) throws. CallMeBot also
 * reports failures with a 2xx status and the error in the body (observed
 * live: 203 "APIKey is invalid", 201 "ERROR: Phone number format is
 * incorrect"), so success requires the "Message queued" body marker and
 * error snippets must never leak the configured phone/apikey.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { WhatsAppChannel, whatsappRegistryEntry } from './whatsapp-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('WhatsAppChannel', () => {
  it('sends a urlencoded GET request to the CallMeBot API and accepts a "Message queued" body', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({
      status: 200,
      body: '<p>Message queued. You will receive it soon.</p>'
    })
    const channel = new WhatsAppChannel(
      { WHATSAPP_PHONE: '+34123123123', WHATSAPP_APIKEY: '1234567890' },
      makeDeps(http)
    )

    await channel.send({ title: 'Build finished', message: 'All tests passed' })

    expect(http.calls).toEqual([
      {
        method: 'GET',
        url:
          'https://api.callmebot.com/whatsapp.php?phone=%2B34123123123&text=Build+finished%0AAll+tests+passed&apikey=1234567890'
      }
    ])
  })

  it('throws when CallMeBot returns 2xx with an error body (invalid apikey) and redacts secrets', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({
      status: 203,
      body: '<b>Message to: +34123123123</b> APIKey is invalid. Please create a new one or contact support if you lost it. (key 1234567890)'
    })
    const channel = new WhatsAppChannel(
      { WHATSAPP_PHONE: '+34123123123', WHATSAPP_APIKEY: '1234567890' },
      makeDeps(http)
    )

    const error = await channel
      .send({ title: 't', message: 'm' })
      .then(() => null)
      .catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toMatch(/APIKey is invalid/)
    expect(error!.message).not.toContain('+34123123123')
    expect(error!.message).not.toContain('1234567890')
  })

  it('throws when CallMeBot returns 2xx with an ERROR body (bad phone format)', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({
      status: 201,
      body: 'ERROR: Phone number format is incorrect'
    })
    const channel = new WhatsAppChannel(
      { WHATSAPP_PHONE: '+34123123123', WHATSAPP_APIKEY: '1234567890' },
      makeDeps(http)
    )

    await expect(channel.send({ title: 't', message: 'm' })).rejects.toThrow(
      /Phone number format/
    )
  })

  it('throws when CallMeBot responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 404, body: 'not_found' })
    const channel = new WhatsAppChannel(
      { WHATSAPP_PHONE: '+34123123123', WHATSAPP_APIKEY: '1234567890' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/whatsapp/i)
  })

  it('throws when CallMeBot rate-limits the request', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 429, body: 'rate_limited' })
    const channel = new WhatsAppChannel(
      { WHATSAPP_PHONE: '+34123123123', WHATSAPP_APIKEY: '1234567890' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/whatsapp/i)
  })

  it('propagates a transport-level failure', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('connection reset'))
    const channel = new WhatsAppChannel(
      { WHATSAPP_PHONE: '+34123123123', WHATSAPP_APIKEY: '1234567890' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('connection reset')
  })

  it('registers the required CallMeBot config', () => {
    expect(whatsappRegistryEntry.requiredConfig).toEqual([
      'WHATSAPP_PHONE',
      'WHATSAPP_APIKEY'
    ])
  })
})
