/**
 * Real MailTransport implementation wrapping nodemailer over SMTP. No
 * unit test (network/SMTP): covered by the docker smoke test (Phase 5) --
 * this file only needs to build cleanly. EmailChannel depends on the
 * MailTransport port, never on nodemailer directly.
 */
import nodemailer from 'nodemailer'
import type { MailTransport } from '../core/ports.js'

export class NodemailerTransport implements MailTransport {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>
  private readonly from: string

  constructor(cfg: Record<string, string>) {
    const port = Number(cfg.SMTP_PORT)
    this.from = cfg.SMTP_USER
    this.transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: cfg.SMTP_USER,
        pass: cfg.SMTP_PASS
      }
    })
  }

  async send(msg: {
    to: string
    subject: string
    text: string
  }): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text
    })
  }
}
