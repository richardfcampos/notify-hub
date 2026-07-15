#!/usr/bin/env node
/**
 * Claude Code notification hook (spec NOTIF-13). Reads a hook-event JSON
 * payload from stdin, maps it to a notify-hub event, builds a Notification
 * body, and POSTs it to the gateway. Zero npm dependencies -- Node stdlib
 * (fs/path/os) + the global `fetch` only -- so it runs in any project
 * without an install step.
 *
 * Never blocks or fails Claude Code: every path (success, gateway error,
 * timeout, malformed input) ends in `process.exit(0)` (spec NOTIF-13.4).
 * Every external seam (event source, `fetch`, `now`) is injected into the
 * exported functions below so tests can drive them without stdin or a
 * real network call.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

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

const DEFAULT_TITLE = 'Claude Code'
const REQUEST_TIMEOUT_MS = 3000

/** Maps a Claude Code `hook_event_name` to a notify-hub event, or `null` when unmapped. */
export function mapEvent(hookEventName) {
  return EVENT_MAP[hookEventName] ?? null
}

function startTimeCachePath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.start`)
}

/**
 * Best-effort: reads and deletes the cached task start-time for this
 * session. Returns `undefined` when there is no session id, no cache
 * file, or the file is unreadable/corrupt -- callers omit durationMs
 * rather than fail (spec NOTIF-13.5).
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

/** Best-effort: caches the current time as this session's task start-time. */
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

/**
 * Builds the notify-hub payload for one hook invocation. `now` is an
 * injected `() => number` clock so tests are deterministic; production
 * passes `Date.now`.
 */
export function buildPayload(hookInput, { now }) {
  const event = mapEvent(hookInput.hook_event_name)
  const project = basename(hookInput.cwd ?? process.cwd())
  const timestamp = new Date(now()).toISOString()

  let message
  if (event === 'end') {
    message = readLastAssistantMessage(hookInput.transcript_path) ?? 'Task finished'
  } else if (event === 'needs-input') {
    message = hookInput.message ?? 'Claude needs your input'
  } else {
    message = 'Task started'
  }

  const metadata = {
    event,
    project,
    timestamp,
    sessionId: hookInput.session_id
  }

  // Duration only applies to the end-of-task push (spec NOTIF-13.1); omit
  // the key entirely (rather than send it as null/0) when it can't be
  // computed, per NOTIF-13.5.
  if (event === 'end') {
    const durationMs = readAndClearStartTime(hookInput.session_id)
    if (durationMs !== undefined) {
      metadata.durationMs = durationMs
    }
  }

  return {
    title: DEFAULT_TITLE,
    message,
    priority: event === 'needs-input' ? 'high' : 'default',
    metadata
  }
}

/**
 * Executes one hook invocation: honors the per-event env toggle, builds
 * the payload, and POSTs it to the gateway. Every failure -- disabled
 * toggle, missing config, network error, timeout, non-2xx response -- is
 * caught/handled here and never thrown, so the caller can always safely
 * exit 0 (spec NOTIF-13.4).
 */
export async function run(hookInput, { fetch: fetchImpl, env, now }) {
  const event = mapEvent(hookInput.hook_event_name)
  if (!event) {
    return
  }

  if (event === 'start') {
    // Cache the start time before the toggle check so a later `end` can
    // still compute duration even if start pushes are disabled.
    writeStartTime(hookInput.session_id, now())
  }

  const toggleEnvKey = TOGGLE_ENV_BY_EVENT[event]
  if (env[toggleEnvKey] === 'false') {
    return
  }

  if (!env.NOTIFY_URL) {
    console.error('notify-hook: NOTIFY_URL not set; skipping notification')
    return
  }

  const payload = buildPayload(hookInput, { now })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchImpl(env.NOTIFY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.NOTIFY_TOKEN ?? ''}`
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
