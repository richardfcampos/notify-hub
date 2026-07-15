/**
 * Shared test doubles for the mockable seams (HttpClient, MailTransport,
 * Clock, Logger). Used by channel-builder/decorator/adapter unit tests --
 * never imported by production code.
 */
import type {
  Clock,
  HttpClient,
  Logger,
  MailTransport
} from '../../src/core/ports.js'

export interface RecordedRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}

export interface HttpResponse {
  status: number
  body: string
}

/**
 * Records every request made through it. Responses/errors are consumed in
 * FIFO order via `queueResponse`/`queueError`; once the queue is empty it
 * falls back to `defaultResponse` (200 by default).
 */
export class FakeHttpClient implements HttpClient {
  readonly calls: RecordedRequest[] = []
  private readonly script: Array<HttpResponse | Error> = []
  defaultResponse: HttpResponse = { status: 200, body: 'ok' }

  queueResponse(response: HttpResponse): void {
    this.script.push(response)
  }

  queueError(error: Error): void {
    this.script.push(error)
  }

  async request(opts: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }): Promise<HttpResponse> {
    this.calls.push({ ...opts })
    const next = this.script.shift()
    if (next instanceof Error) {
      throw next
    }
    return next ?? this.defaultResponse
  }
}

export interface RecordedMail {
  to: string
  subject: string
  text: string
}

/** Records every send; `throwOnSend` scripts a failure for every send after it's set. */
export class FakeMailTransport implements MailTransport {
  readonly calls: RecordedMail[] = []
  private error: Error | null = null

  throwOnSend(error: Error): void {
    this.error = error
  }

  async send(msg: RecordedMail): Promise<void> {
    this.calls.push({ ...msg })
    if (this.error) {
      throw this.error
    }
  }
}

/** Deterministic time source; starts at 0 (or a given value) and only moves via `advance`/`set`. */
export class FakeClock implements Clock {
  constructor(private currentTime = 0) {}

  now(): number {
    return this.currentTime
  }

  advance(ms: number): void {
    this.currentTime += ms
  }

  set(time: number): void {
    this.currentTime = time
  }
}

export interface LoggedEntry {
  level: 'info' | 'warn' | 'error'
  obj: unknown
  msg?: string
}

/** Records every log call so tests can assert attempt/outcome logging without a real logger. */
export class FakeLogger implements Logger {
  readonly entries: LoggedEntry[] = []

  info(o: unknown, m?: string): void {
    this.entries.push({ level: 'info', obj: o, msg: m })
  }

  warn(o: unknown, m?: string): void {
    this.entries.push({ level: 'warn', obj: o, msg: m })
  }

  error(o: unknown, m?: string): void {
    this.entries.push({ level: 'error', obj: o, msg: m })
  }
}
