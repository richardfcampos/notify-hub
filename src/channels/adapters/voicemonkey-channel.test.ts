/**
 * Tests derive from spec VM-01 (.specs/features/voicemonkey-channel/spec.md):
 * exact Announce API request via FakeHttpClient (verified endpoint/body
 * shape), non-2xx -> throws with the documented `{"error":"CODE"}` parsed
 * out, UTF-8/accented text survives, and (unlike CallMeBot) a 2xx response
 * is always treated as success since Voice Monkey's docs show no
 * "2xx-but-failed" pattern -- only real non-2xx status codes for errors.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { VoiceMonkeyChannel, voicemonkeyRegistryEntry } from './voicemonkey-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('VoiceMonkeyChannel', () => {
  it('POSTs the exact Announce API request with token/device/speech', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 200, body: '{"success":true,"data":"OK"}' })
    const channel = new VoiceMonkeyChannel(
      { VOICEMONKEY_TOKEN: 'tok_abc123', VOICEMONKEY_DEVICE: 'echo-kitchen' },
      makeDeps(http)
    )

    await channel.send({ title: 'Build finished', message: 'All tests passed' })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'https://api-v3.voicemonkey.io/announce',
        headers: { 'content-type': 'application/json' },
        body: {
          token: 'tok_abc123',
          device: 'echo-kitchen',
          speech: 'Build finished. All tests passed'
        }
      }
    ])
  })

  it('survives UTF-8/accented characters in the spoken text', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 200, body: '{"success":true,"data":"OK"}' })
    const channel = new VoiceMonkeyChannel(
      { VOICEMONKEY_TOKEN: 'tok_abc123', VOICEMONKEY_DEVICE: 'echo-kitchen' },
      makeDeps(http)
    )

    await channel.send({ title: 'Café pronto', message: 'A reunião começou às 10h' })

    expect(http.calls[0]!.body).toEqual({
      token: 'tok_abc123',
      device: 'echo-kitchen',
      speech: 'Café pronto. A reunião começou às 10h'
    })
  })

  it('throws with the parsed error code on a non-2xx response (invalid token)', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 401, body: '{"error":"INVALID_TOKEN"}' })
    const channel = new VoiceMonkeyChannel(
      { VOICEMONKEY_TOKEN: 'tok_bad', VOICEMONKEY_DEVICE: 'echo-kitchen' },
      makeDeps(http)
    )

    const error = await channel
      .send({ title: 't', message: 'm' })
      .then(() => null)
      .catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toMatch(/INVALID_TOKEN/)
    expect(error!.message).toMatch(/voicemonkey/i)
  })

  it('throws with extra context fields for a throttled error', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({
      status: 429,
      body: '{"error":"THROTTLED","lockoutUntil":"2026-07-17T23:00:00Z"}'
    })
    const channel = new VoiceMonkeyChannel(
      { VOICEMONKEY_TOKEN: 'tok_abc123', VOICEMONKEY_DEVICE: 'echo-kitchen' },
      makeDeps(http)
    )

    await expect(channel.send({ title: 't', message: 'm' })).rejects.toThrow(
      /THROTTLED.*lockoutUntil=2026-07-17T23:00:00Z/
    )
  })

  it('falls back to a sanitized raw body and redacts the token/device when the body is not the documented JSON shape', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({
      status: 500,
      body: '<html>upstream failure for token tok_abc123 on device echo-kitchen</html>'
    })
    const channel = new VoiceMonkeyChannel(
      { VOICEMONKEY_TOKEN: 'tok_abc123', VOICEMONKEY_DEVICE: 'echo-kitchen' },
      makeDeps(http)
    )

    const error = await channel
      .send({ title: 't', message: 'm' })
      .then(() => null)
      .catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).not.toContain('tok_abc123')
    expect(error!.message).not.toContain('echo-kitchen')
    expect(error!.message).toContain('<redacted>')
  })

  it('propagates a transport-level failure', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('connection reset'))
    const channel = new VoiceMonkeyChannel(
      { VOICEMONKEY_TOKEN: 'tok_abc123', VOICEMONKEY_DEVICE: 'echo-kitchen' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('connection reset')
  })

  it('registers the required Voice Monkey config with no artificial maxLength', () => {
    expect(voicemonkeyRegistryEntry.requiredConfig).toEqual([
      'VOICEMONKEY_TOKEN',
      'VOICEMONKEY_DEVICE'
    ])
    expect(voicemonkeyRegistryEntry.maxLength).toBeUndefined()
  })
})
