#!/usr/bin/env node
/**
 * Claude Code notification hook (spec NOTIF-13, HOOK-01..05). Reads a
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
 * Never blocks or fails Claude Code: every path (success, gateway error,
 * timeout, malformed input, missing config) ends in `process.exit(0)`
 * (spec NOTIF-13.4). Every external seam (event source, `fetch`, `now`) is
 * injected into the exported functions below so tests can drive them
 * without stdin or a real network call.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

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
  'NOTIFY_ON_NEEDS_INPUT'
]
const CONFIG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'notify-hub', 'hook.env')

const DEFAULT_TITLE = 'Claude Code'
const REQUEST_TIMEOUT_MS = 3000
const GIT_TIMEOUT_MS = 1000
const HEADLINE_MAX_LENGTH = 140
const MAX_BODY_LENGTH = 400

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
 * Executes one hook invocation: resolves config (env, falling back to the
 * config file), honors the per-event toggle, builds the payload, and
 * POSTs it to the gateway. Every failure -- disabled toggle, missing
 * config, network error, timeout, non-2xx response -- is caught/handled
 * here and never thrown, so the caller can always safely exit 0 (spec
 * NOTIF-13.4).
 */
export async function run(hookInput, { fetch: fetchImpl, env, now }) {
  const event = mapEvent(hookInput.hook_event_name)
  if (!event) {
    return
  }

  if (event === 'start') {
    // Cache the start time before the toggle check so a later `end` can
    // still compute duration even though start pushes default to off.
    writeStartTime(hookInput.session_id, now())
  }

  const config = resolveConfig(env)

  if (!isEventEnabled(event, config)) {
    return
  }

  if (!config.NOTIFY_URL) {
    console.error('notify-hook: NOTIFY_URL not set; skipping notification')
    return
  }

  const payload = buildPayload(hookInput, { now })
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

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  try {
    const raw = await readStdin()
    const hookInput = raw.trim() ? JSON.parse(raw) : {}
    await run(hookInput, { fetch, env: process.env, now: Date.now })
  } catch (error) {
    console.error(`notify-hook: unexpected error: ${error?.message ?? error}`)
  } finally {
    process.exit(0)
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  void main()
}
