/**
 * Tests derive from spec AC NOTIF-07.3 (SMTP send to configured
 * recipient) and T7's "Done when": EmailChannel.send calls
 * MailTransport.send with the correct to/subject/text; a transport error
 * propagates. NodemailerTransport has no unit test per the coverage
 * matrix (build-gate only).
 */
import { describe, expect, it } from 'vitest'
import type { ChannelDeps } from '../../core/types.js'
import {
  FakeHttpClient,
  FakeLogger,
  FakeMailTransport
} from '../../../test/helpers/fakes.js'
import { EmailChannel } from './email-channel.js'

function makeDeps(mail: FakeMailTransport): ChannelDeps {
  return { http: new FakeHttpClient(), mail, logger: new FakeLogger() }
}

describe('EmailChannel', () => {
  it('sends via MailTransport with the configured recipient, title as subject, message as text', async () => {
    const mail = new FakeMailTransport()
    const channel = new EmailChannel({ EMAIL_TO: 'me@example.com' }, makeDeps(mail))

    await channel.send({ title: 'Build finished', message: 'All tests passed' })

    expect(mail.calls).toEqual([
      { to: 'me@example.com', subject: 'Build finished', text: 'All tests passed' }
    ])
  })

  it('propagates a MailTransport failure', async () => {
    const mail = new FakeMailTransport()
    mail.throwOnSend(new Error('smtp connection refused'))
    const channel = new EmailChannel({ EMAIL_TO: 'me@example.com' }, makeDeps(mail))

    await expect(
      channel.send({ title: 't', message: 'm' })
    ).rejects.toThrow('smtp connection refused')
  })
})
