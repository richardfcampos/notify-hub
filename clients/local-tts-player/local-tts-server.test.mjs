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
