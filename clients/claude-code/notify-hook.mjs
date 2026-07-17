#!/usr/bin/env node
/**
 * Claude Code notification hook (spec NOTIF-13, HOOK-01..06). Reads a
 * hook-event JSON payload from stdin, maps it to a notify-hub event,
 * builds a rich Notification body (project, times, status, headline), and
 * POSTs it to the gateway. Zero npm dependencies -- Node stdlib
 * (fs/path/os/child_process) + the global `fetch` only -- so it runs in
 * any project without an install step.
 *
 * Config is read from process.env first, falling back to a KEY=VALUE file
 * at `~/.config/notify-hub/hook.env` (spec HOOK-04) so a user never has to
 * touch a shell profile.
 *
 * End-of-task pushes are idle-debounced (spec HOOK-06): `Stop` persists the
 * payload and spawns a detached copy of this same script in
 * `--deferred-send` mode instead of sending right away, so a burst of
 * conversational turns collapses into a single push once the session goes
 * quiet for `NOTIFY_IDLE_SECONDS`. `UserPromptSubmit` refreshes an
 * "activity" marker the deferred sender checks on wake to cancel itself
 * when the user is already back.
 *
 * Never blocks or fails Claude Code: every path (success, gateway error,
 * timeout, malformed input, missing config) ends in `process.exit(0)`
 * (spec NOTIF-13.4). Every external seam (event source, `fetch`, `now`,
 * `spawn`, `sleep`) is injected into the exported functions below so tests
 * can drive them without stdin, a real network call, a real child process,
 * or a real wait.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

const EVENT_MAP = {
  UserPromptSubmit: 'start',
  Stop: 'end',
  Notification: 'needs-input'
}

const TOGGLE_ENV_BY_EVENT = {
  start: 'NOTIFY_ON_START',
  end: 'NOTIFY_ON_END',
  'needs-input': 'NOTIFY_ON_NEEDS_INPUT'
}

const CONFIG_KEYS = [
  'NOTIFY_URL',
  'NOTIFY_TOKEN',
  'NOTIFY_ON_START',
  'NOTIFY_ON_END',
  'NOTIFY_ON_NEEDS_INPUT',
  'NOTIFY_IDLE_SECONDS'
]
const CONFIG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'notify-hub', 'hook.env')

const DEFAULT_TITLE = 'Claude Code'
const REQUEST_TIMEOUT_MS = 3000
const GIT_TIMEOUT_MS = 1000
const HEADLINE_MAX_LENGTH = 140
const MAX_BODY_LENGTH = 400
// Default idle window before a debounced 'end' push actually sends (spec
// HOOK-06.1); `0` disables debouncing entirely (legacy immediate send).
const DEFAULT_IDLE_SECONDS = 180

/** Maps a Claude Code `hook_event_name` to a notify-hub event, or `null` when unmapped. */
export function mapEvent(hookEventName) {
  return EVENT_MAP[hookEventName] ?? null
}

/** Truncates `text` to `max` chars, appending an ellipsis when it was cut. */
function capLength(text, max) {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max - 1).trimEnd()}…`
}

// --- Config file fallback (spec HOOK-04) -----------------------------------

/**
 * Parses a simple `KEY=VALUE` config file: blank lines and `#` comments
 * are skipped, and any line that isn't a valid `KEY=VALUE` pair (no `=`,
 * or a key that isn't a legal env-var identifier) is ignored rather than
 * failing the whole file -- a single typo in `hook.env` never blocks the
 * hook from reading the rest of its config.
 */
export function parseConfigFile(content) {
  const config = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }
    const key = line.slice(0, eqIndex).trim()
    if (!CONFIG_KEY_PATTERN.test(key)) {
      continue
    }
    config[key] = line.slice(eqIndex + 1).trim()
  }
  return config
}

/** Best-effort read of the config file at `path`; missing/unreadable -> `{}`. */
function readConfigFile(path) {
  try {
    if (!existsSync(path)) {
      return {}
    }
    return parseConfigFile(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Resolves the hook's runtime config: env vars win; any of `CONFIG_KEYS`
 * missing from env falls back to the config file (default
 * `~/.config/notify-hub/hook.env`, overridable via `NOTIFY_HOOK_CONFIG`
 * so tests -- and multi-profile setups -- can point elsewhere).
 */
export function resolveConfig(env) {
  const configPath = env.NOTIFY_HOOK_CONFIG || DEFAULT_CONFIG_PATH
  const fileConfig = readConfigFile(configPath)
  const resolved = {}
  for (const key of CONFIG_KEYS) {
    resolved[key] = env[key] !== undefined ? env[key] : fileConfig[key]
  }
  return resolved
}

/**
 * Whether a push should be sent for `event` given the resolved config.
 * Start pushes are opt-in (must be explicitly `"true"`) since start-time
 * is always cached silently for duration regardless; end/needs-input stay
 * opt-out (anything but explicit `"false"` sends).
 */
function isEventEnabled(event, config) {
  const value = config[TOGGLE_ENV_BY_EVENT[event]]
  return event === 'start' ? value === 'true' : value !== 'false'
}

/**
 * Resolves how many seconds an 'end' push waits before actually sending
 * (spec HOOK-06.1). Missing or non-numeric/negative values fall back to
 * `DEFAULT_IDLE_SECONDS` rather than silently disabling the debounce;
 * `0` is the explicit legacy opt-out (immediate send, pre-Amendment-1
 * behavior).
 */
export function resolveIdleSeconds(config) {
  const parsed = Number(config.NOTIFY_IDLE_SECONDS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_IDLE_SECONDS
}

// --- Start-time caching ------------------------------------------------------

function startTimeCachePath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.start`)
}

/**
 * Best-effort: reads and deletes the cached task start-time for this
 * session. Returns `undefined` when there is no session id, no cache
 * file, or the file is unreadable/corrupt -- callers omit start/duration
 * fields rather than fail (spec NOTIF-13.5).
 */
function readAndClearStartTime(sessionId) {
  if (!sessionId) {
    return undefined
  }
  const path = startTimeCachePath(sessionId)
  try {
    if (!existsSync(path)) {
      return undefined
    }
    const parsed = Number(readFileSync(path, 'utf8').trim())
    try {
      unlinkSync(path)
    } catch {
      // Cleanup is best-effort; a leftover cache file never blocks sending.
    }
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Best-effort: caches the current time as this session's task start-time.
 * Called unconditionally on every UserPromptSubmit, independent of
 * NOTIFY_ON_START, so `end` can still compute a duration even when the
 * start push itself is disabled (spec HOOK-04.3).
 */
function writeStartTime(sessionId, startedAt) {
  if (!sessionId) {
    return
  }
  try {
    writeFileSync(startTimeCachePath(sessionId), String(startedAt), 'utf8')
  } catch {
    // Best-effort; a failed cache write never blocks the hook.
  }
}

// --- Idle-debounce state (spec HOOK-06) ---------------------------------------

function activityCachePath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.activity`)
}

/**
 * Best-effort: caches the current time as this session's last-activity
 * marker. Refreshed on every `UserPromptSubmit` (spec HOOK-06.2) so a
 * deferred sender still waiting out its idle window can tell the user
 * already came back. Unlike the start-time cache this file is
 * intentionally NOT cleared on read -- it stays a "user was here at T"
 * fact until the next prompt overwrites it.
 */
function writeActivityTime(sessionId, activityAt) {
  if (!sessionId) {
    return
  }
  try {
    writeFileSync(activityCachePath(sessionId), String(activityAt), 'utf8')
  } catch {
    // Best-effort; a failed cache write never blocks the hook.
  }
}

/**
 * Best-effort read (no delete) of the last-activity marker. Returns
 * `undefined` when there is no session id, no cache file, or the file is
 * unreadable/corrupt -- a deferred sender that can't read this treats the
 * user as absent rather than blocking the send (spec NOTIF-13.5).
 */
function readActivityTime(sessionId) {
  if (!sessionId) {
    return undefined
  }
  const path = activityCachePath(sessionId)
  try {
    if (!existsSync(path)) {
      return undefined
    }
    const parsed = Number(readFileSync(path, 'utf8').trim())
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function pendingPayloadPath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.pending`)
}

/**
 * Best-effort: persists the computed end-of-task payload alongside its
 * Stop timestamp so a detached deferred sender -- a fresh process -- can
 * pick it up after the idle window. Overwriting is intentional: a newer
 * Stop for the same session always replaces the older pending entry, and
 * whichever deferred sender reads back a matching `stopTs` is the one that
 * gets to send (spec HOOK-06.1/3).
 */
function writePendingPayload(sessionId, stopTs, payload) {
  try {
    writeFileSync(pendingPayloadPath(sessionId), JSON.stringify({ stopTs, payload }), 'utf8')
  } catch {
    // Best-effort; if this write fails the deferred sender finds nothing
    // and exits silently -- the push is lost, Claude is never blocked.
  }
}

/** Best-effort read (no delete) of the pending payload; `undefined` when absent/corrupt. */
function readPendingPayload(sessionId) {
  const path = pendingPayloadPath(sessionId)
  try {
    if (!existsSync(path)) {
      return undefined
    }
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed?.stopTs === 'number' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Best-effort delete of the pending payload file once a deferred sender has consumed it. */
function deletePendingPayload(sessionId) {
  try {
    unlinkSync(pendingPayloadPath(sessionId))
  } catch {
    // Cleanup is best-effort; a leftover pending file never blocks anything.
  }
}

/**
 * Pure decision for whether a deferred sender -- woken up after its idle
 * wait -- should actually send (spec HOOK-06.2/3). `false` when either:
 * newer activity than this Stop exists (the user came back), or the
 * current pending entry is missing/belongs to a different (newer) Stop
 * (this send was superseded). Exported so the truth table is unit-testable
 * without spawning a real child process or waiting out a real timer.
 */
export function shouldDeferredSend({ activityTs, pendingStopTs, myStopTs }) {
  if (activityTs !== undefined && activityTs > myStopTs) {
    return false
  }
  if (pendingStopTs === undefined || pendingStopTs !== myStopTs) {
    return false
  }
  return true
}

/**
 * Spawns a detached, unref'd copy of this same script in `--deferred-send`
 * mode so the idle wait happens in an independent process: `Stop` returns
 * (and Claude Code un-blocks) immediately regardless of how long
 * `NOTIFY_IDLE_SECONDS` is (spec HOOK-06.1). Best-effort: a spawn failure
 * just means the debounced push is lost, never that Stop errors.
 */
function spawnDeferredSender(sessionId, stopTs, spawnImpl) {
  const ownPath = process.argv[1]
  if (!ownPath) {
    return
  }
  try {
    const child = spawnImpl(process.execPath, [ownPath, '--deferred-send', sessionId, String(stopTs)], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref?.()
  } catch {
    // Best-effort; see doc comment above.
  }
}

// --- Transcript reading -------------------------------------------------------

/**
 * Best-effort: extracts the last assistant message's text from a Claude
 * Code transcript JSONL file. Returns `undefined` on any read/parse
 * failure or when no assistant entry is found (spec NOTIF-13.5).
 */
function readLastAssistantMessage(transcriptPath) {
  if (!transcriptPath) {
    return undefined
  }
  try {
    const lines = readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)

    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i])
      if (entry?.type !== 'assistant') {
        continue
      }
      const content = entry.message?.content
      if (typeof content === 'string' && content.length > 0) {
        return content
      }
      if (Array.isArray(content)) {
        const textBlock = content.find(
          (block) => block?.type === 'text' && typeof block.text === 'string'
        )
        if (textBlock) {
          return textBlock.text
        }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

// --- Project naming (spec HOOK-05) --------------------------------------------

/**
 * Resolves the project name for `cwd`: the git repository's toplevel
 * basename, or -- when `cwd` sits inside a git *worktree* -- the basename
 * of the *main* repository (so a worktree session is still labeled with
 * the real project, not the worktree's own directory name). Falls back to
 * `basename(cwd)` when git is unavailable, `cwd` isn't a repo, or any git
 * call errors/times out; `spawnSyncImpl` is injectable for tests.
 */
export function resolveProjectName(cwd, { spawnSyncImpl = spawnSync } = {}) {
  const dir = cwd || process.cwd()
  try {
    const toplevelResult = spawnSyncImpl('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS
    })
    if (toplevelResult.error || toplevelResult.status !== 0 || !toplevelResult.stdout?.trim()) {
      return basename(dir)
    }
    const toplevelPath = toplevelResult.stdout.trim()

    const commonDirResult = spawnSyncImpl('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS
    })
    if (commonDirResult.error || commonDirResult.status !== 0 || !commonDirResult.stdout?.trim()) {
      return basename(toplevelPath)
    }
    const commonDirRaw = commonDirResult.stdout.trim()
    // `--git-common-dir` is relative to `dir` (not necessarily `toplevel`)
    // when it isn't already absolute -- e.g. run from a subdirectory it
    // comes back as `../../.git`, and for a worktree it's already the
    // absolute path to the *main* repo's `.git` dir.
    const commonDirPath = isAbsolute(commonDirRaw) ? commonDirRaw : resolvePath(dir, commonDirRaw)
    return basename(dirname(commonDirPath))
  } catch {
    return basename(dir)
  }
}

// --- Status heuristic (spec HOOK-02) ------------------------------------------

/**
 * Classifies the end-of-task status from the last assistant message: if
 * its final non-empty paragraph ends with `?`, Claude is waiting on a
 * decision; otherwise the task is considered done. A missing/unreadable
 * message defaults to done (never guesses "decision" without evidence).
 */
export function classifyEndStatus(lastAssistantMessage) {
  if (lastAssistantMessage) {
    const paragraphs = lastAssistantMessage
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0)
    const finalParagraph = paragraphs[paragraphs.length - 1]
    if (finalParagraph?.endsWith('?')) {
      return { emoji: '🤔', label: 'aguardando sua decisão' }
    }
  }
  return { emoji: '✅', label: 'concluído' }
}

/**
 * First non-empty line of `text`, stripped of leading markdown prefixes
 * (`#`, `*`, `_`, `>`) and truncated to a short headline.
 */
export function extractHeadline(text) {
  if (!text) {
    return ''
  }
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) {
    return ''
  }
  const stripped = firstLine.replace(/^[#*_>\s]+/, '').trim()
  return capLength(stripped, HEADLINE_MAX_LENGTH)
}

// --- Time/duration formatting --------------------------------------------------

/** Formats an epoch-ms timestamp as local `HH:MM` (system timezone). */
export function formatLocalTime(ms) {
  const date = new Date(ms)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Humanizes a millisecond duration: `<1min`, `12min`, or `1h 04min`. */
export function formatDuration(ms) {
  if (ms < 60_000) {
    return '<1min'
  }
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}min`
  }
  return `${minutes}min`
}

// --- Payload assembly (spec HOOK-01/03) ----------------------------------------

function buildTitle(emoji, project, label) {
  return `${emoji} ${project} — ${label}`
}

function buildEndBody(startedAtMs, endedAtMs, headline) {
  const endTime = formatLocalTime(endedAtMs)
  const timeLine =
    startedAtMs !== undefined
      ? `Início ${formatLocalTime(startedAtMs)} · Fim ${endTime} (${formatDuration(endedAtMs - startedAtMs)})`
      : `Fim ${endTime}`
  return headline ? `${timeLine}\n\n${headline}` : timeLine
}

function buildNeedsInputBody(project, message) {
  return `Projeto: ${project}\n${message}`
}

/**
 * Builds the notify-hub payload for one hook invocation. `now` is an
 * injected `() => number` clock so tests are deterministic; production
 * passes `Date.now`.
 */
export function buildPayload(hookInput, { now }) {
  const event = mapEvent(hookInput.hook_event_name)
  const project = resolveProjectName(hookInput.cwd)
  const nowMs = now()
  const timestamp = new Date(nowMs).toISOString()

  const metadata = {
    event,
    project,
    timestamp,
    sessionId: hookInput.session_id
  }

  let title = DEFAULT_TITLE
  let message = 'Task started'
  let priority = 'default'

  if (event === 'end') {
    // Duration only applies to the end-of-task push; omit the key
    // entirely (rather than send it as null/0) when it can't be computed
    // (no cached start time for this session), per NOTIF-13.5.
    const startedAtMs = readAndClearStartTime(hookInput.session_id)
    if (startedAtMs !== undefined) {
      metadata.durationMs = nowMs - startedAtMs
    }

    const lastAssistantMessage = readLastAssistantMessage(hookInput.transcript_path)
    const { emoji, label } = classifyEndStatus(lastAssistantMessage)
    const headline = extractHeadline(lastAssistantMessage)

    title = buildTitle(emoji, project, label)
    message = capLength(buildEndBody(startedAtMs, nowMs, headline), MAX_BODY_LENGTH)
  } else if (event === 'needs-input') {
    title = buildTitle('🙋', project, 'precisa de você')
    message = capLength(
      buildNeedsInputBody(project, hookInput.message ?? 'Claude precisa da sua atenção.'),
      MAX_BODY_LENGTH
    )
    priority = 'high'
  }

  return { title, message, priority, metadata }
}

/**
 * POSTs `payload` to the gateway. Every failure -- network error, timeout,
 * non-2xx response -- is caught/handled here and never thrown, so both
 * callers (`run`'s immediate path and `runDeferredSend`) can always safely
 * continue to `process.exit(0)` (spec NOTIF-13.4).
 */
async function postPayload(config, payload, fetchImpl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchImpl(config.NOTIFY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.NOTIFY_TOKEN ?? ''}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    if (!response.ok) {
      console.error(`notify-hook: gateway responded with status ${response.status}`)
    }
  } catch (error) {
    console.error(`notify-hook: failed to reach gateway: ${error?.message ?? error}`)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Executes one hook invocation: resolves config (env, falling back to the
 * config file), honors the per-event toggle, then either sends immediately
 * or -- for `end`, when idle-debouncing is on -- persists the payload and
 * hands it off to a detached deferred sender (spec HOOK-06.1). Every
 * failure -- disabled toggle, missing config, network error, timeout,
 * non-2xx response -- is caught/handled here and never thrown, so the
 * caller can always safely exit 0 (spec NOTIF-13.4).
 */
export async function run(hookInput, { fetch: fetchImpl, env, now, spawn: spawnImpl = spawn }) {
  const event = mapEvent(hookInput.hook_event_name)
  if (!event) {
    return
  }

  if (event === 'start') {
    // Cache the start time before the toggle check so a later `end` can
    // still compute duration even though start pushes default to off;
    // also refresh the activity marker so any pending deferred send for
    // this session is cancelled the moment the user is back (HOOK-06.2).
    writeStartTime(hookInput.session_id, now())
    writeActivityTime(hookInput.session_id, now())
  }

  const config = resolveConfig(env)

  if (!isEventEnabled(event, config)) {
    return
  }

  if (!config.NOTIFY_URL) {
    console.error('notify-hook: NOTIFY_URL not set; skipping notification')
    return
  }

  if (event === 'end' && hookInput.session_id) {
    const idleSeconds = resolveIdleSeconds(config)
    if (idleSeconds > 0) {
      // Debounce: persist the payload, spawn a detached sender that fires
      // after the idle window, and return immediately -- `Stop` must never
      // keep Claude Code waiting (spec HOOK-06.1).
      const stopTs = now()
      const payload = buildPayload(hookInput, { now: () => stopTs })
      writePendingPayload(hookInput.session_id, stopTs, payload)
      spawnDeferredSender(hookInput.session_id, stopTs, spawnImpl)
      return
    }
  }

  const payload = buildPayload(hookInput, { now })
  await postPayload(config, payload, fetchImpl)
}

/**
 * Runs the deferred (debounced) 'end' send: sleeps `NOTIFY_IDLE_SECONDS`
 * then re-checks whether this Stop is still the freshest signal for the
 * session (spec HOOK-06.2/3) via `shouldDeferredSend`. A cancelled or
 * superseded send exits without touching the pending file -- it may
 * already belong to a newer, still-running deferred sender. `sleep` is an
 * injected `(ms) => Promise<void>` so tests can skip the real wait.
 */
export async function runDeferredSend(sessionId, stopTs, { fetch: fetchImpl, env, sleep: sleepImpl = sleep }) {
  const config = resolveConfig(env)
  const idleSeconds = resolveIdleSeconds(config)
  await sleepImpl(idleSeconds * 1000)

  const activityTs = readActivityTime(sessionId)
  const pending = readPendingPayload(sessionId)

  if (!shouldDeferredSend({ activityTs, pendingStopTs: pending?.stopTs, myStopTs: stopTs })) {
    return
  }

  if (config.NOTIFY_URL) {
    await postPayload(config, pending.payload, fetchImpl)
  } else {
    console.error('notify-hook: NOTIFY_URL not set; skipping deferred notification')
  }
  deletePendingPayload(sessionId)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Entry point. `--deferred-send <sessionId> <stopTs>` re-invokes this same
 * script as the detached idle-wait process spawned by `run` on `Stop`
 * (spec HOOK-06.1); anything else is a normal hook invocation reading the
 * event JSON from stdin. Both branches always exit 0.
 */
async function main() {
  try {
    if (process.argv[2] === '--deferred-send') {
      const sessionId = process.argv[3]
      const stopTs = Number(process.argv[4])
      if (sessionId && Number.isFinite(stopTs)) {
        await runDeferredSend(sessionId, stopTs, { fetch, env: process.env })
      }
      return
    }

    const raw = await readStdin()
    const hookInput = raw.trim() ? JSON.parse(raw) : {}
    await run(hookInput, { fetch, env: process.env, now: Date.now })
  } catch (error) {
    console.error(`notify-hook: unexpected error: ${error?.message ?? error}`)
  } finally {
    process.exit(0)
  }
}

// `pathToFileURL` (not a raw `file://` string concat) so this comparison
// still matches when the install path needs URL-encoding -- e.g. a space
// in the directory name, which a plain `file://${argv[1]}` concat would
// never equal against the percent-encoded `import.meta.url`.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  void main()
}
