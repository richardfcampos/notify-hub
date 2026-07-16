/**
 * Shared test doubles for the mockable seams (HttpClient, MailTransport,
 * Clock, Logger, FileStore, CommandRunner). Used by channel-builder/
 * decorator/adapter and admin-panel unit/e2e tests -- never imported by
 * production code.
 */
import type {
  Clock,
  HttpClient,
  Logger,
  MailTransport,
  ChannelRepository,
  ProfileRepository
} from '../../src/core/ports.js'
import type { ChannelInstance, ProfileRecord } from '../../src/core/types.js'
import type { FileStore } from '../../src/admin/env-file-store.js'
import type { CommandResult, CommandRunner } from '../../src/admin/command-runner.js'

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

/**
 * In-memory FileStore (admin panel). `read()` returns null until content is
 * seeded/written, matching the real store's "file doesn't exist yet"
 * behavior. `backup()` records a fake path per call (null when there is
 * nothing to back up) instead of touching disk.
 */
export class FakeFileStore implements FileStore {
  content: string | null
  readonly backups: string[] = []
  private backupCounter = 0

  constructor(initialContent: string | null = null) {
    this.content = initialContent
  }

  async read(): Promise<string | null> {
    return this.content
  }

  async write(content: string): Promise<void> {
    this.content = content
  }

  async backup(): Promise<string | null> {
    if (this.content === null) {
      return null
    }
    this.backupCounter += 1
    const path = `fake-backup-${this.backupCounter}`
    this.backups.push(path)
    return path
  }
}

export interface RecordedCommand {
  cmd: string
  args: string[]
  opts?: { cwd?: string; timeoutMs?: number }
}

/**
 * Records every invocation. Results are consumed in FIFO order via
 * `queueResult`; once the queue is empty it falls back to `defaultResult`
 * (exit code 0, empty output).
 */
export class FakeCommandRunner implements CommandRunner {
  readonly calls: RecordedCommand[] = []
  private readonly script: CommandResult[] = []
  defaultResult: CommandResult = { code: 0, stdout: '', stderr: '' }

  queueResult(result: CommandResult): void {
    this.script.push(result)
  }

  async run(
    cmd: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number }
  ): Promise<CommandResult> {
    this.calls.push({ cmd, args, opts })
    return this.script.shift() ?? this.defaultResult
  }
}

/** In-memory ChannelRepository (clones on the way in/out so callers can't mutate stored state). */
export class FakeChannelRepository implements ChannelRepository {
  private readonly store = new Map<string, ChannelInstance>()

  constructor(initial: ChannelInstance[] = []) {
    for (const channel of initial) {
      this.store.set(channel.id, structuredClone(channel))
    }
  }

  list(): ChannelInstance[] {
    return [...this.store.values()].map((c) => structuredClone(c))
  }

  listEnabled(): ChannelInstance[] {
    return this.list().filter((c) => c.enabled)
  }

  get(id: string): ChannelInstance | null {
    const channel = this.store.get(id)
    return channel ? structuredClone(channel) : null
  }

  upsert(channel: ChannelInstance): void {
    this.store.set(channel.id, structuredClone(channel))
  }

  delete(id: string): void {
    this.store.delete(id)
  }
}

/** In-memory ProfileRepository mirroring the SQLite one's contract. */
export class FakeProfileRepository implements ProfileRepository {
  private readonly store = new Map<string, ProfileRecord>()

  constructor(initial: ProfileRecord[] = []) {
    for (const profile of initial) {
      this.store.set(profile.id, structuredClone(profile))
    }
  }

  list(): ProfileRecord[] {
    return [...this.store.values()].map((p) => structuredClone(p))
  }

  get(id: string): ProfileRecord | null {
    const profile = this.store.get(id)
    return profile ? structuredClone(profile) : null
  }

  resolveByToken(token: string | undefined): ProfileRecord | null {
    if (!token) {
      return null
    }
    for (const profile of this.store.values()) {
      if (profile.token === token) {
        return structuredClone(profile)
      }
    }
    return null
  }

  upsert(profile: ProfileRecord): void {
    this.store.set(profile.id, structuredClone(profile))
  }

  delete(id: string): void {
    this.store.delete(id)
  }

  setDefaultChannels(profileId: string, channelIds: string[]): void {
    const profile = this.store.get(profileId)
    if (profile) {
      profile.defaultChannels = [...channelIds]
    }
  }
}
