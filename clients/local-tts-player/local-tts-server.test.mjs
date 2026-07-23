/**
 * Tests derive from spec LTTS-01's ACs: loopback-only bind, `/voices`
 * parsing (name = exact string required by `say -v`, disambiguating
 * same-named voices across locales), `/speak` injection-safety via
 * array-args `execFile` + fire-and-forget response, and default-voice
 * fallback for an unknown/empty voice. No real Mac or `say` binary is
 * needed -- every `execFile` call is injected via a fake seam, and the
 * fixture below is a REAL `say -v '?'` sample captured live on this
 * machine (confirms the parser against actual macOS output, including the
 * 14-duplicate-"Grandma" disambiguation bug this feature fixes).
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRequestHandler,
  createSpeechQueue,
  DEFAULT_VOICE,
  HOST,
  parseVoicesOutput,
  speak,
  startServer
} from './local-tts-server.mjs'

// Real `say -v '?'` output captured live on this machine: multi-locale,
// includes 4 differently-located "Grandma" entries (the ambiguous-name bug
// this feature fixes) plus the two Portuguese voices the feature defaults to.
const SAMPLE_VOICES_OUTPUT = `Grandma (German (Germany)) de_DE    # Hallo! Ich heiße Grandma.
Grandma (English (UK)) en_GB    # Hello! My name is Grandma.
Grandma (English (US)) en_US    # Hello! My name is Grandma.
Grandma (Portuguese (Brazil)) pt_BR    # Olá, meu nome é Grandma.
Luciana             pt_BR    # Olá, meu nome é Luciana.
Joana                pt_PT    # Olá! Chamo‑me Joana.`

/** Fake `execFile` seam: records every call and resolves/never-resolves as scripted. */
function makeFakeExecFile({ stdout = '', neverResolve = false } = {}) {
  const calls = []
  function fakeExecFile(command, args) {
    calls.push({ command, args })
    if (neverResolve) {
      return new Promise(() => {
        // Intentionally never settles -- proves the caller doesn't await it.
      })
    }
    return Promise.resolve({ stdout, stderr: '' })
  }
  fakeExecFile.calls = calls
  return fakeExecFile
}

/** Minimal fake `http.IncomingMessage`/`ServerResponse` pair for route-handler tests. */
function makeFakeReq({ method, url, bodyChunks = [] }) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  queueMicrotask(() => {
    for (const chunk of bodyChunks) {
      req.emit('data', Buffer.from(chunk))
    }
    req.emit('end')
  })
  return req
}

function makeFakeRes() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(payload) {
      this.body = payload
    }
  }
}

describe('parseVoicesOutput', () => {
  it('parses the Grandma pt_BR entry into its exact disambiguated say -v name', () => {
    const voices = parseVoicesOutput(SAMPLE_VOICES_OUTPUT)
    const grandmaBr = voices.find((v) => v.locale === 'pt_BR' && v.name.startsWith('Grandma'))

    expect(grandmaBr).toEqual({
      name: 'Grandma (Portuguese (Brazil))',
      locale: 'pt_BR',
      sample: 'Olá, meu nome é Grandma.'
    })
  })

  it('produces 4 distinct names for the 4 differently-located Grandma entries', () => {
    const voices = parseVoicesOutput(SAMPLE_VOICES_OUTPUT)
    const grandmaNames = voices.filter((v) => v.name.startsWith('Grandma')).map((v) => v.name)

    expect(grandmaNames).toHaveLength(4)
    expect(new Set(grandmaNames).size).toBe(4)
  })

  it('parses the plain single-word Luciana/Joana entries with no name ambiguity', () => {
    const voices = parseVoicesOutput(SAMPLE_VOICES_OUTPUT)

    expect(voices).toContainEqual({ name: 'Luciana', locale: 'pt_BR', sample: 'Olá, meu nome é Luciana.' })
    expect(voices).toContainEqual({ name: 'Joana', locale: 'pt_PT', sample: 'Olá! Chamo‑me Joana.' })
  })

  it('skips blank lines without producing empty entries', () => {
    const voices = parseVoicesOutput(`${SAMPLE_VOICES_OUTPUT}\n\n`)
    expect(voices.every((v) => v.name.length > 0)).toBe(true)
  })

  it('parses a UN M49 numeric region locale (e.g. Arabic ar_001, no single country) -- verified live on this machine', () => {
    const voices = parseVoicesOutput('Majed               ar_001   # مرحبًا! اسمي ماجد.')
    expect(voices).toEqual([{ name: 'Majed', locale: 'ar_001', sample: 'مرحبًا! اسمي ماجد.' }])
  })
})

describe('speak', () => {
  it('invokes say with voice/text as literal argv array elements -- proves no shell interpretation', () => {
    const execFileImpl = makeFakeExecFile({ neverResolve: true })
    const maliciousText = 'hello"; rm -rf / #'

    const result = speak({ voice: 'Luciana', text: maliciousText }, { execFileImpl })

    expect(execFileImpl.calls).toEqual([{ command: 'say', args: ['-v', 'Luciana', maliciousText] }])
    expect(execFileImpl.calls[0].args).toHaveLength(3)
    expect(execFileImpl.calls[0].args[2]).toBe(maliciousText)
  })

  it('returns 202 synchronously WITHOUT waiting for execFile to resolve (fire-and-forget)', () => {
    const execFileImpl = makeFakeExecFile({ neverResolve: true })

    const result = speak({ voice: 'Luciana', text: 'oi' }, { execFileImpl })

    // The fake's promise above never resolves; if `speak` awaited it, this
    // assertion would never be reached (the test would hang/timeout).
    expect(result).toEqual({ status: 202, body: { ok: true, voice: 'Luciana' } })
  })

  it('falls back to the configured default voice when voice is missing', () => {
    const execFileImpl = makeFakeExecFile()

    speak({ text: 'oi' }, { execFileImpl, defaultVoice: 'Luciana' })

    expect(execFileImpl.calls[0].args).toEqual(['-v', 'Luciana', 'oi'])
  })

  it('falls back to the configured default voice when voice is an empty string', () => {
    const execFileImpl = makeFakeExecFile()

    speak({ voice: '', text: 'oi' }, { execFileImpl, defaultVoice: 'Luciana' })

    expect(execFileImpl.calls[0].args).toEqual(['-v', 'Luciana', 'oi'])
  })

  it('uses the module DEFAULT_VOICE constant when no defaultVoice override is passed', () => {
    const execFileImpl = makeFakeExecFile()

    speak({ text: 'oi' }, { execFileImpl })

    expect(execFileImpl.calls[0].args).toEqual(['-v', DEFAULT_VOICE, 'oi'])
  })

  it('rejects an empty text with 400 and never invokes say', () => {
    const execFileImpl = makeFakeExecFile()

    const result = speak({ voice: 'Luciana', text: '   ' }, { execFileImpl })

    expect(result.status).toBe(400)
    expect(execFileImpl.calls).toHaveLength(0)
  })

  it('rejects a missing/non-string text with 400 and never invokes say', () => {
    const execFileImpl = makeFakeExecFile()

    const result = speak({ voice: 'Luciana' }, { execFileImpl })

    expect(result.status).toBe(400)
    expect(execFileImpl.calls).toHaveLength(0)
  })

  it('logs (but does not throw) when the fire-and-forget execFile call eventually rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const execFileImpl = () => Promise.reject(new Error('say: command not found'))

    expect(() => speak({ voice: 'Luciana', text: 'oi' }, { execFileImpl })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('say: command not found'))
    errorSpy.mockRestore()
  })
})

describe('createSpeechQueue (sequential playback, spec VNR-02)', () => {
  it('runs the first enqueued item immediately when idle, but holds a second item until the first settles (AC1)', async () => {
    const events = []
    let resolveFirst
    const queue = createSpeechQueue()

    queue.enqueue(() => {
      events.push('first:start')
      return new Promise((resolve) => {
        resolveFirst = () => {
          events.push('first:end')
          resolve()
        }
      })
    })
    queue.enqueue(() => {
      events.push('second:start')
      return Promise.resolve()
    })

    // The queue was idle, so the first item ran synchronously already;
    // the second must NOT have started -- it's queued behind the first.
    expect(events).toEqual(['first:start'])

    resolveFirst()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('still runs a later item after an earlier one throws synchronously (failure isolation, AC2)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queue = createSpeechQueue()
    let secondRan = false

    queue.enqueue(() => {
      throw new Error('say: boom')
    })
    queue.enqueue(() => {
      secondRan = true
      return Promise.resolve()
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(secondRan).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('say: boom'))
    errorSpy.mockRestore()
  })

  it('still runs a later item after an earlier one rejects asynchronously (failure isolation, AC2)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queue = createSpeechQueue()
    let secondRan = false

    queue.enqueue(() => Promise.reject(new Error('say: async boom')))
    queue.enqueue(() => {
      secondRan = true
      return Promise.resolve()
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(secondRan).toBe(true)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('say: async boom'))
    errorSpy.mockRestore()
  })

  it('runs three or more rapid items in strict arrival order, none dropped', async () => {
    const order = []
    const resolvers = []
    const queue = createSpeechQueue()

    for (const label of ['a', 'b', 'c']) {
      queue.enqueue(
        () =>
          new Promise((resolve) => {
            resolvers.push(() => {
              order.push(label)
              resolve()
            })
          })
      )
    }

    // Only the first item's fn has run so far (queue was idle for it).
    expect(resolvers).toHaveLength(1)

    resolvers[0]()
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolvers[1]()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolvers).toHaveLength(3)
    resolvers[2]()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(order).toEqual(['a', 'b', 'c'])
  })
})

describe('speak (shared queue integration, spec VNR-02)', () => {
  it('serializes two rapid speak() calls sharing a queue -- second say does not start until first resolves', async () => {
    const events = []
    let resolveFirst
    const execFileImpl = vi.fn((command, args) => {
      const text = args[2]
      events.push(`start:${text}`)
      if (text === 'first') {
        return new Promise((resolve) => {
          resolveFirst = () => {
            events.push('end:first')
            resolve({ stdout: '', stderr: '' })
          }
        })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    const queue = createSpeechQueue()

    const resultA = speak({ voice: 'Luciana', text: 'first' }, { execFileImpl, queue })
    const resultB = speak({ voice: 'Luciana', text: 'second' }, { execFileImpl, queue })

    // Both /speak calls return 202 immediately even though 'second' is
    // still waiting behind 'first' in the queue (LTTS-01 AC3 / VNR-02 AC3).
    expect(resultA).toEqual({ status: 202, body: { ok: true, voice: 'Luciana' } })
    expect(resultB).toEqual({ status: 202, body: { ok: true, voice: 'Luciana' } })
    expect(events).toEqual(['start:first'])
    expect(execFileImpl).toHaveBeenCalledTimes(1)

    resolveFirst()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events).toEqual(['start:first', 'end:first', 'start:second'])
    expect(execFileImpl).toHaveBeenCalledTimes(2)
  })

  it('a failing queued say does not block a later queued speak() call from still running (AC2)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const execFileImpl = vi.fn((command, args) =>
      args[2] === 'boom'
        ? Promise.reject(new Error('say: boom'))
        : Promise.resolve({ stdout: '', stderr: '' })
    )
    const queue = createSpeechQueue()

    speak({ voice: 'Luciana', text: 'boom' }, { execFileImpl, queue })
    speak({ voice: 'Luciana', text: 'after' }, { execFileImpl, queue })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(execFileImpl).toHaveBeenNthCalledWith(2, 'say', ['-v', 'Luciana', 'after'])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('say: boom'))
    errorSpy.mockRestore()
  })

  it('returns 202 for every speak() call immediately regardless of how many items are already queued (AC3)', () => {
    const execFileImpl = makeFakeExecFile({ neverResolve: true })
    const queue = createSpeechQueue()

    const resultA = speak({ voice: 'Luciana', text: 'slow' }, { execFileImpl, queue })
    const resultB = speak({ voice: 'Luciana', text: 'queued behind it' }, { execFileImpl, queue })
    const resultC = speak({ voice: 'Luciana', text: 'also queued' }, { execFileImpl, queue })

    expect(resultA).toEqual({ status: 202, body: { ok: true, voice: 'Luciana' } })
    expect(resultB).toEqual({ status: 202, body: { ok: true, voice: 'Luciana' } })
    expect(resultC).toEqual({ status: 202, body: { ok: true, voice: 'Luciana' } })
  })
})

describe('createRequestHandler', () => {
  it('GET /voices returns the parsed list with 200', async () => {
    const handler = createRequestHandler({
      execFileImpl: makeFakeExecFile({ stdout: SAMPLE_VOICES_OUTPUT })
    })
    const req = makeFakeReq({ method: 'GET', url: '/voices' })
    const res = makeFakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(6)
  })

  it('POST /speak responds 202 without waiting for say to finish', async () => {
    const execFileImpl = makeFakeExecFile({ neverResolve: true })
    const handler = createRequestHandler({ execFileImpl, defaultVoice: 'Luciana' })
    const req = makeFakeReq({
      method: 'POST',
      url: '/speak',
      bodyChunks: [JSON.stringify({ voice: 'Luciana', text: 'oi' })]
    })
    const res = makeFakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(202)
    expect(execFileImpl.calls).toEqual([{ command: 'say', args: ['-v', 'Luciana', 'oi'] }])
  })

  it('POST /speak with malformed JSON returns 400', async () => {
    const handler = createRequestHandler({ execFileImpl: makeFakeExecFile() })
    const req = makeFakeReq({ method: 'POST', url: '/speak', bodyChunks: ['{not valid json'] })
    const res = makeFakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
  })

  it('unknown routes return 404', async () => {
    const handler = createRequestHandler({ execFileImpl: makeFakeExecFile() })
    const req = makeFakeReq({ method: 'GET', url: '/nope' })
    const res = makeFakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(404)
  })

  it('GET /voices surfaces an execFile failure as 500 instead of crashing', async () => {
    const handler = createRequestHandler({
      execFileImpl: () => Promise.reject(new Error('say binary not found'))
    })
    const req = makeFakeReq({ method: 'GET', url: '/voices' })
    const res = makeFakeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(500)
  })
})

describe('startServer', () => {
  let server

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
      server = undefined
    }
  })

  it('binds to 127.0.0.1 only, never 0.0.0.0', async () => {
    expect(HOST).toBe('127.0.0.1')

    // PORT=0 asks the OS for a free ephemeral port; no request is made so
    // the real `say` binary is never invoked (safe on any OS/CI).
    server = startServer({ PORT: '0', DEFAULT_VOICE: 'Luciana' })
    await new Promise((resolve) => server.once('listening', resolve))

    expect(server.address().address).toBe(HOST)
  })
})
