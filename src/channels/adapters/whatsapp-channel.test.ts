/**
 * Tests derive from spec AC NOTIF-15.1/15.2 and T22's "Done when": exact
 * CallMeBot GET request (urlencoded phone/text/apikey) via FakeHttpClient;
 * non-2xx (incl. rate-limit) throws.
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
  it('sends a urlencoded GET request to the CallMeBot API', async () => {
    const http = new FakeHttpClient()
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
