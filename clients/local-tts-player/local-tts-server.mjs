#!/usr/bin/env node
/**
 * Local TTS player service (spec LTTS-01). Standalone host-level Node
 * process -- run directly on the Mac via launchd, NOT inside Docker
 * (Docker Desktop for Mac has no CoreAudio access from inside a
 * container) -- that exposes macOS's built-in `say` command over a tiny
 * loopback-only HTTP API so notify-hub's `local-tts` channel adapter can
 * speak notifications out loud through this Mac's own speakers. Zero npm
 * dependencies -- Node stdlib (`http`/`child_process`) only, matching the
 * project's "thin host client" pattern (clients/claude-code/notify-hook.mjs).
 *
 * `GET /voices` lists every installed voice, parsed from `say -v '?'`,
 * using the EXACT name string macOS requires for `say -v` -- this
 * disambiguates the ~14 identically-named "Grandma" voices (one per
 * locale) that otherwise silently resolve to the wrong language when
 * passed a bare, ambiguous name (the bug this feature fixes).
 *
 * `POST /speak {voice, text}` invokes `say` via `execFile` with array
 * args ONLY (never a shell string), so notification text containing
 * quotes, semicolons, or backticks is passed as a single literal argv
 * element with zero shell interpretation. Responds `202` immediately
 * WITHOUT waiting for `say` to finish speaking (fire-and-forget -- a long
 * announcement shouldn't hold the HTTP connection open); completion and
 * failures are logged to stderr instead.
 *
 * Every external seam (`execFile`) is injected via dependency injection so
 * the route logic is testable with a fake -- no real Mac or `say` binary
 * needed to run the test suite.
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

export const HOST = '127.0.0.1'
export const DEFAULT_PORT = 8082
export const DEFAULT_VOICE = 'Luciana'

// Matches one `say -v '?'` line: `<name...>  <locale>    # <sample>`.
// `name` can contain spaces and nested parens (e.g. disambiguated voices
// like "Grandma (Portuguese (Brazil))"); `locale` is normally a `xx_XX`
// code but macOS also uses UN M49 numeric region codes for languages with
// no single country (e.g. Arabic's `ar_001` -- verified live on this
// machine), hence the alnum region class rather than a strict `[A-Z]{2}`.
// The lazy `(.+?)` only stops expanding once it reaches a run of
// whitespace immediately followed by a locale code, more whitespace, then
// `#`, so it never mistakes text inside the name for the locale/sample
// separator.
const VOICE_LINE_PATTERN = /^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]{2,3})\s+#\s*(.*)$/

/**
 * Parses raw `say -v '?'` stdout into `[{name, locale, sample}]`. Blank
 * lines and any line that doesn't match the expected shape are skipped
 * rather than failing the whole list -- a single malformed/unexpected
 * line (locale-only entries, future format additions) never blocks the
 * rest of the voices from being usable.
 */
export function parseVoicesOutput(stdout) {
  const voices = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line) {
      continue
    }
    const match = VOICE_LINE_PATTERN.exec(line)
    if (!match) {
      continue
    }
    const [, name, locale, sample] = match
    voices.push({ name: name.trim(), locale, sample: sample.trim() })
  }
  return voices
}

/**
 * Lists installed voices by invoking `say -v '?'` through the injected
 * `execFileImpl` (production wires the real `execFile`; tests inject a
 * fake). This one IS awaited -- unlike `/speak`, the HTTP response must
 * carry the parsed list, so the caller needs the command to actually
 * finish first.
 */
export async function listVoices({ execFileImpl }) {
  const { stdout } = await execFileImpl('say', ['-v', '?'])
  return parseVoicesOutput(stdout)
}

/** `text` must be present and a non-empty (post-trim) string. */
function isValidSpeakBody(body) {
  return typeof body?.text === 'string' && body.text.trim().length > 0
}

function logSpeakFailure(error) {
  console.error(`local-tts-player: say failed: ${error?.message ?? error}`)
}

/**
 * Tiny in-process FIFO queue so two near-simultaneous `/speak` requests
 * never play over each other (spec VNR-02 AC1). `enqueue(fn)` runs `fn`
 * immediately when the queue is idle (a single, isolated `/speak` call
 * behaves exactly as before -- `execFileImpl` invoked synchronously) but,
 * when an earlier item is still in flight, holds `fn` until that item
 * settles before starting it -- this is what stops two overlapping `say`
 * invocations. A rejection (or synchronous throw) from one item is caught
 * and logged rather than propagated, so a failed item never blocks items
 * queued behind it (AC2). `enqueue` itself never returns a promise the
 * caller needs to await -- it's fire-and-forget by design, same contract
 * as the old direct `execFileImpl` call.
 */
export function createSpeechQueue() {
  const pending = []
  let running = false

  function runNext() {
    const fn = pending.shift()
    if (!fn) {
      running = false
      return
    }
    running = true
    let result
    try {
      result = fn()
    } catch (error) {
      logSpeakFailure(error)
      runNext()
      return
    }
    Promise.resolve(result).catch(logSpeakFailure).then(runNext)
  }

  function enqueue(fn) {
    pending.push(fn)
    if (!running) {
      runNext()
    }
  }

  return { enqueue }
}

/**
 * Handles a `/speak` request: invokes `say` via the injected
 * `execFileImpl` with array args (`-v <voice> <text>`, text as ONE argv
 * element -- never shell-interpolated, so injection attempts land as
 * inert literal text), routed through `queue` so overlapping requests
 * play one at a time (spec VNR-02 AC1), and returns a `202` immediately
 * WITHOUT awaiting completion (fire-and-forget, spec LTTS-01 AC3 /
 * VNR-02 AC3) -- this function isn't even declared `async`, so its return
 * value is synchronous by construction regardless of how long the
 * underlying `say` call (or the queue ahead of it) takes. An unknown/empty
 * voice falls back to `defaultVoice` (AC5). Completion and failure are
 * logged to stderr asynchronously rather than surfaced to the caller.
 */
export function speak(body, { execFileImpl, defaultVoice = DEFAULT_VOICE, queue = createSpeechQueue() }) {
  if (!isValidSpeakBody(body)) {
    return { status: 400, body: { error: 'text is required' } }
  }
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice : defaultVoice

  // Enqueued, not awaited: the 202 below returns to the caller before this
  // (or anything queued ahead of it) settles.
  queue.enqueue(() => execFileImpl('say', ['-v', voice, body.text]))

  return { status: 202, body: { ok: true, voice } }
}

/** Reads and JSON-parses a request body; rejects on malformed JSON or a stream error. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Builds the request handler with `execFileImpl`/`defaultVoice` injected
 * (production wires the real `execFile` + resolved `DEFAULT_VOICE`
 * env/constant; tests inject fakes -- no real HTTP server or `say` binary
 * needed). One `speak` queue is created per handler instance -- shared
 * across every `/speak` request this handler serves (so overlapping
 * requests to the same running server serialize, spec VNR-02) but never
 * a module-level global (each server/test gets its own, no cross-test
 * leakage).
 */
export function createRequestHandler({ execFileImpl, defaultVoice = DEFAULT_VOICE }) {
  const queue = createSpeechQueue()

  return async function requestHandler(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/voices') {
        const voices = await listVoices({ execFileImpl })
        sendJson(res, 200, voices)
        return
      }

      if (req.method === 'POST' && req.url === '/speak') {
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { error: 'malformed JSON body' })
          return
        }
        const result = speak(body, { execFileImpl, defaultVoice, queue })
        sendJson(res, result.status, result.body)
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      sendJson(res, 500, { error: error?.message ?? 'internal error' })
    }
  }
}

/** Real `execFile`, promisified -- resolves `{stdout, stderr}` as utf8 strings. */
function realExecFileImpl(command, args) {
  return promisify(execFile)(command, args)
}

/** `env.PORT` resolved to a number; missing/blank/non-numeric falls back to `DEFAULT_PORT`. */
function resolvePort(env) {
  if (env.PORT === undefined || env.PORT === '') {
    return DEFAULT_PORT
  }
  const parsed = Number(env.PORT)
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT
}

/** `env.DEFAULT_VOICE` resolved; missing/blank falls back to the `DEFAULT_VOICE` constant. */
function resolveDefaultVoice(env) {
  return typeof env.DEFAULT_VOICE === 'string' && env.DEFAULT_VOICE.trim()
    ? env.DEFAULT_VOICE
    : DEFAULT_VOICE
}

/**
 * Starts the real server bound to `127.0.0.1` ONLY (never `0.0.0.0` --
 * this is a host-level trust boundary: only this machine + Docker's
 * host-gateway routing can ever reach it, same posture as every other
 * loopback-bound piece of this stack). `env` is injected so tests never
 * bind a real, fixed port.
 */
export function startServer(env = process.env) {
  const port = resolvePort(env)
  const defaultVoice = resolveDefaultVoice(env)
  const handler = createRequestHandler({ execFileImpl: realExecFileImpl, defaultVoice })
  const server = createServer(handler)

  server.on('error', (error) => {
    console.error(`local-tts-player: server error: ${error?.message ?? error}`)
    process.exitCode = 1
  })

  server.listen(port, HOST, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : port
    console.error(`local-tts-player: listening on http://${HOST}:${actualPort}`)
  })

  return server
}

// `pathToFileURL` (not a raw `file://` string concat) so this comparison
// still matches when the install path needs URL-encoding -- e.g. a space
// in the directory name, which a plain `file://${argv[1]}` concat would
// never equal against the percent-encoded `import.meta.url`.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  startServer()
}
