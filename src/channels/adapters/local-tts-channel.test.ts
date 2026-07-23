/**
 * Tests derive from spec LTTS-02 + VNR-01's ACs: POST `{voice, text}` to
 * `<LOCAL_TTS_URL>/speak` with `text` = the brief spoken summary (title
 * with any leading emoji/symbol run stripped, never the full `message`),
 * or just `message` when there's no title; non-2xx/unreachable -> throws;
 * registry entry declares the required config keys.
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { LocalTtsChannel, localTtsRegistryEntry } from './local-tts-channel.js'

function makeDeps(http: FakeHttpClient): ChannelDeps {
  return { http, mail: new FakeMailTransport(), logger: new FakeLogger() }
}

describe('LocalTtsChannel', () => {
  it('POSTs the configured player URL with the voice and the stripped title as text (VNR-01 AC1)', async () => {
    const http = new FakeHttpClient()
    const channel = new LocalTtsChannel(
      { LOCAL_TTS_URL: 'http://host.docker.internal:8082', LOCAL_TTS_VOICE: 'Luciana' },
      makeDeps(http)
    )

    await channel.send({ title: '✅ notify-hub — concluído', message: 'Início: ... Fim: ...' })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'http://host.docker.internal:8082/speak',
        headers: { 'content-type': 'application/json' },
        body: { voice: 'Luciana', text: 'notify-hub — concluído' }
      }
    ])
  })

  it('does not include message in the request body when a title is present', async () => {
    const http = new FakeHttpClient()
    const channel = new LocalTtsChannel(
      { LOCAL_TTS_URL: 'http://127.0.0.1:8082', LOCAL_TTS_VOICE: 'Luciana' },
      makeDeps(http)
    )

    await channel.send({ title: 'Build finished', message: 'All tests passed and more' })

    const body = http.calls[0]!.body as { text: string }
    expect(body.text).toBe('Build finished')
    expect(body.text).not.toContain('All tests passed')
  })

  it('falls back to speaking just the message (VNR-01 AC2) when the notification has no title', async () => {
    const http = new FakeHttpClient()
    const channel = new LocalTtsChannel(
      { LOCAL_TTS_URL: 'http://127.0.0.1:8082', LOCAL_TTS_VOICE: 'Luciana' },
      makeDeps(http)
    )

    await channel.send({ title: '', message: 'All tests passed' })

    expect(http.calls).toEqual([
      {
        method: 'POST',
        url: 'http://127.0.0.1:8082/speak',
        headers: { 'content-type': 'application/json' },
        body: { voice: 'Luciana', text: 'All tests passed' }
      }
    ])
  })

  it('throws when the player responds with a non-2xx status', async () => {
    const http = new FakeHttpClient()
    http.queueResponse({ status: 500, body: 'internal error' })
    const channel = new LocalTtsChannel(
      { LOCAL_TTS_URL: 'http://127.0.0.1:8082', LOCAL_TTS_VOICE: 'Luciana' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow(/local-tts/i)
  })

  it('propagates a transport-level failure (player unreachable)', async () => {
    const http = new FakeHttpClient()
    http.queueError(new Error('connect ECONNREFUSED'))
    const channel = new LocalTtsChannel(
      { LOCAL_TTS_URL: 'http://127.0.0.1:8082', LOCAL_TTS_VOICE: 'Luciana' },
      makeDeps(http)
    )

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('connect ECONNREFUSED')
  })

  it('registers the required player URL + voice config with no maxLength', () => {
    expect(localTtsRegistryEntry.requiredConfig).toEqual(['LOCAL_TTS_URL', 'LOCAL_TTS_VOICE'])
    expect(localTtsRegistryEntry.maxLength).toBeUndefined()
  })
})
