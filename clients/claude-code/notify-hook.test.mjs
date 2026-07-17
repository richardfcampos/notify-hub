/**
 * Tests derive from spec NOTIF-13, HOOK-01..05, and Amendment 1's HOOK-06
 * ACs: event mapping, config resolution (env-first, config-file fallback,
 * malformed lines ignored), start-time caching (always, independent of the
 * toggle), project naming (git toplevel, worktree resolves to the main
 * repo), the done/decision/needs-input status heuristic, payload
 * shape/field values, env-toggle gating (fetch not called when disabled),
 * exit-0-on-error behavior (`run` never throws), and the idle-debounced
 * end-of-task send (pending-file persistence, detached-spawn hand-off,
 * activity-based cancellation, stale-send supersession). No real network
 * call, child process, or wait is ever made -- `fetch`, `spawn`, and
 * `sleep` are all injected fakes. Every `run()`/`resolveConfig()` test
 * pins `NOTIFY_HOOK_CONFIG` to either a controlled temp file or a
 * guaranteed-missing path so these tests never depend on (or are broken
 * by) a real `~/.config/notify-hub/hook.env` on the machine running them.
 */
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildPayload,
  classifyEndStatus,
  extractHeadline,
  formatDuration,
  formatLocalTime,
  mapEvent,
  parseConfigFile,
  resolveConfig,
  resolveIdleSeconds,
  resolveProjectName,
  run,
  runDeferredSend,
  shouldDeferredSend
} from './notify-hook.mjs'

const createdSessionIds = []
const tempPathsToClean = []

function freshSessionId() {
  const id = `test-${randomUUID()}`
  createdSessionIds.push(id)
  return id
}

function startCachePath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.start`)
}

function activityCachePath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.activity`)
}

function pendingPayloadPath(sessionId) {
  return join(tmpdir(), `notify-hub-${sessionId}.pending`)
}

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempPathsToClean.push(dir)
  return dir
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

// A no-op spawn fake for tests that only care whether `run()` sent
// immediately vs. deferred -- records nothing, never actually spawns.
function noopSpawn() {
  return { unref() {} }
}

// Guaranteed not to exist on disk -- keeps run()/resolveConfig() tests
// hermetic regardless of whether a real hook.env has been created on this
// machine (e.g. by the H2 live-bootstrap step).
const MISSING_CONFIG_PATH = join(tmpdir(), 'notify-hub-hook-test-missing-config', 'hook.env')

afterEach(() => {
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop()
    for (const path of [startCachePath(id), activityCachePath(id), pendingPayloadPath(id)]) {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
  }
  while (tempPathsToClean.length > 0) {
    const path = tempPathsToClean.pop()
    rmSync(path, { recursive: true, force: true })
  }
})

describe('mapEvent', () => {
  it('maps UserPromptSubmit to start', () => {
    expect(mapEvent('UserPromptSubmit')).toBe('start')
  })

  it('maps Stop to end', () => {
    expect(mapEvent('Stop')).toBe('end')
  })

  it('maps Notification to needs-input', () => {
    expect(mapEvent('Notification')).toBe('needs-input')
  })

  it('maps any other event name to null', () => {
    expect(mapEvent('PreToolUse')).toBeNull()
    expect(mapEvent(undefined)).toBeNull()
  })
})

describe('parseConfigFile', () => {
  it('parses KEY=VALUE lines', () => {
    const config = parseConfigFile('NOTIFY_URL=http://localhost:8080/notify\nNOTIFY_TOKEN=abc123\n')
    expect(config).toEqual({ NOTIFY_URL: 'http://localhost:8080/notify', NOTIFY_TOKEN: 'abc123' })
  })

  it('ignores blank lines and comments', () => {
    const config = parseConfigFile('\n# a comment\n  \nNOTIFY_URL=http://x\n# another\n')
    expect(config).toEqual({ NOTIFY_URL: 'http://x' })
  })

  it('ignores lines without an "=" sign', () => {
    const config = parseConfigFile('NOTIFY_URL=http://x\nnot a valid line\n')
    expect(config).toEqual({ NOTIFY_URL: 'http://x' })
  })

  it('ignores lines with an invalid key', () => {
    const config = parseConfigFile('3BAD=x\n=novalue\nNOTIFY_URL=http://x\n')
    expect(config).toEqual({ NOTIFY_URL: 'http://x' })
  })

  it('keeps everything after the first "=" as the value, including a nested "="', () => {
    const config = parseConfigFile('NOTIFY_URL=http://localhost:8080/notify?a=b\n')
    expect(config.NOTIFY_URL).toBe('http://localhost:8080/notify?a=b')
  })

  it('trims whitespace around keys and values', () => {
    const config = parseConfigFile('  NOTIFY_URL = http://x  \n')
    expect(config).toEqual({ NOTIFY_URL: 'http://x' })
  })
})

describe('resolveConfig', () => {
  it('reads all values from the config file when env has none', () => {
    const dir = makeTempDir('notify-hub-hook-test-config-')
    const configPath = join(dir, 'hook.env')
    writeFileSync(
      configPath,
      'NOTIFY_URL=http://localhost:8080/notify\nNOTIFY_TOKEN=filetoken\nNOTIFY_ON_END=true\n',
      'utf8'
    )

    const config = resolveConfig({ NOTIFY_HOOK_CONFIG: configPath })

    expect(config.NOTIFY_URL).toBe('http://localhost:8080/notify')
    expect(config.NOTIFY_TOKEN).toBe('filetoken')
    expect(config.NOTIFY_ON_END).toBe('true')
  })

  it('env vars take precedence over the config file', () => {
    const dir = makeTempDir('notify-hub-hook-test-config-')
    const configPath = join(dir, 'hook.env')
    writeFileSync(configPath, 'NOTIFY_URL=http://from-file\n', 'utf8')

    const config = resolveConfig({ NOTIFY_HOOK_CONFIG: configPath, NOTIFY_URL: 'http://from-env' })

    expect(config.NOTIFY_URL).toBe('http://from-env')
  })

  it('ignores a malformed line but still resolves the rest of the file', () => {
    const dir = makeTempDir('notify-hub-hook-test-config-')
    const configPath = join(dir, 'hook.env')
    writeFileSync(configPath, 'this is not valid\nNOTIFY_URL=http://ok\n', 'utf8')

    const config = resolveConfig({ NOTIFY_HOOK_CONFIG: configPath })

    expect(config.NOTIFY_URL).toBe('http://ok')
  })

  it('leaves keys undefined when neither env nor the config file has them', () => {
    const config = resolveConfig({ NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH })
    expect(config.NOTIFY_URL).toBeUndefined()
    expect(config.NOTIFY_TOKEN).toBeUndefined()
  })
})

describe('resolveProjectName (injected spawnSync)', () => {
  it('uses the git toplevel basename for a normal repo', () => {
    const spawnSyncImpl = (_cmd, args) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/Users/dev/my-project\n' }
      }
      if (args.includes('--git-common-dir')) {
        return { status: 0, stdout: '.git\n' }
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`)
    }

    expect(resolveProjectName('/Users/dev/my-project', { spawnSyncImpl })).toBe('my-project')
  })

  it('resolves to the MAIN repo name when git-common-dir points elsewhere (worktree)', () => {
    const spawnSyncImpl = (_cmd, args) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/Users/dev/my-project-wt\n' }
      }
      if (args.includes('--git-common-dir')) {
        return { status: 0, stdout: '/Users/dev/my-project/.git\n' }
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`)
    }

    expect(resolveProjectName('/Users/dev/my-project-wt', { spawnSyncImpl })).toBe('my-project')
  })

  it('resolves a relative git-common-dir against cwd (subdirectory case)', () => {
    const spawnSyncImpl = (_cmd, args) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/Users/dev/my-project\n' }
      }
      if (args.includes('--git-common-dir')) {
        return { status: 0, stdout: '../../.git\n' }
      }
      throw new Error(`unexpected git args: ${args.join(' ')}`)
    }

    expect(resolveProjectName('/Users/dev/my-project/sub/dir', { spawnSyncImpl })).toBe('my-project')
  })

  it('falls back to basename(cwd) when git exits non-zero (not a repo)', () => {
    const spawnSyncImpl = () => ({ status: 128, stdout: '' })
    expect(resolveProjectName('/Users/dev/not-a-repo', { spawnSyncImpl })).toBe('not-a-repo')
  })

  it('falls back to basename(cwd) when spawnSync reports an error (git not found)', () => {
    const spawnSyncImpl = () => ({ error: new Error('ENOENT'), status: null, stdout: '' })
    expect(resolveProjectName('/Users/dev/some-project', { spawnSyncImpl })).toBe('some-project')
  })

  it('falls back to basename(cwd) when spawnSyncImpl throws', () => {
    const spawnSyncImpl = () => {
      throw new Error('boom')
    }
    expect(resolveProjectName('/Users/dev/some-project', { spawnSyncImpl })).toBe('some-project')
  })

  it('falls back to basename(toplevel) when the git-common-dir call fails after toplevel succeeds', () => {
    const spawnSyncImpl = (_cmd, args) => {
      if (args.includes('--show-toplevel')) {
        return { status: 0, stdout: '/Users/dev/my-project\n' }
      }
      return { status: 1, stdout: '' }
    }
    expect(resolveProjectName('/Users/dev/my-project', { spawnSyncImpl })).toBe('my-project')
  })
})

describe('resolveProjectName (real git, integration)', () => {
  it('resolves a plain repo to its own basename', () => {
    const repoDir = makeTempDir('notify-hub-hook-test-repo-')
    runGit(['init', '-q'], repoDir)

    expect(resolveProjectName(repoDir)).toBe(basename(repoDir))
  })

  it('resolves a worktree session to the MAIN repo name', () => {
    const mainDir = makeTempDir('notify-hub-hook-test-main-')
    runGit(['init', '-q'], mainDir)
    runGit(
      ['-c', 'user.email=test@test.com', '-c', 'user.name=Test', 'commit', '--allow-empty', '-q', '-m', 'init'],
      mainDir
    )

    const worktreeDir = join(tmpdir(), `notify-hub-hook-test-wt-${randomUUID()}`)
    tempPathsToClean.push(worktreeDir)
    runGit(['worktree', 'add', '-q', '-b', `wt-${randomUUID()}`, worktreeDir], mainDir)

    expect(resolveProjectName(worktreeDir)).toBe(basename(mainDir))
  })

  it('falls back to basename(cwd) for a directory that is not a git repo', () => {
    const plainDir = makeTempDir('notify-hub-hook-test-plain-')
    expect(resolveProjectName(plainDir)).toBe(basename(plainDir))
  })
})

describe('classifyEndStatus', () => {
  it('classifies as done when there is no last message', () => {
    expect(classifyEndStatus(undefined)).toEqual({ emoji: '✅', label: 'concluído' })
  })

  it('classifies as done when the final paragraph does not end with "?"', () => {
    expect(classifyEndStatus('All tests pass.\n\nReady to merge.')).toEqual({
      emoji: '✅',
      label: 'concluído'
    })
  })

  it('classifies as a pending decision when the final paragraph ends with "?"', () => {
    expect(classifyEndStatus('Implemented the feature.\n\nShould I also update the docs?')).toEqual({
      emoji: '🤔',
      label: 'aguardando sua decisão'
    })
  })

  it('only looks at the FINAL paragraph, not an earlier one', () => {
    expect(classifyEndStatus('Is this ok?\n\nYes, all done.')).toEqual({
      emoji: '✅',
      label: 'concluído'
    })
  })
})

describe('extractHeadline', () => {
  it('returns an empty string for missing text', () => {
    expect(extractHeadline(undefined)).toBe('')
    expect(extractHeadline('')).toBe('')
  })

  it('picks the first non-empty line', () => {
    expect(extractHeadline('\n\n  Task done  \nmore details below')).toBe('Task done')
  })

  it('strips leading markdown prefixes', () => {
    expect(extractHeadline('## Summary of changes')).toBe('Summary of changes')
    expect(extractHeadline('> Quoted headline')).toBe('Quoted headline')
  })

  it('truncates long lines to ~140 chars with an ellipsis', () => {
    const headline = extractHeadline('x'.repeat(200))
    expect(headline.length).toBe(140)
    expect(headline.endsWith('…')).toBe(true)
  })
})

describe('formatLocalTime', () => {
  it('formats an epoch-ms timestamp as local HH:MM', () => {
    const date = new Date(2026, 0, 2, 9, 5, 0)
    expect(formatLocalTime(date.getTime())).toBe('09:05')
  })

  it('pads single-digit hours and minutes', () => {
    const date = new Date(2026, 5, 15, 0, 3, 0)
    expect(formatLocalTime(date.getTime())).toBe('00:03')
  })
})

describe('formatDuration', () => {
  it('formats sub-minute durations as "<1min"', () => {
    expect(formatDuration(30_000)).toBe('<1min')
    expect(formatDuration(0)).toBe('<1min')
  })

  it('formats an exact minute boundary', () => {
    expect(formatDuration(60_000)).toBe('1min')
  })

  it('formats minutes under an hour', () => {
    expect(formatDuration(12 * 60_000)).toBe('12min')
  })

  it('formats hours with zero-padded minutes', () => {
    expect(formatDuration(64 * 60_000)).toBe('1h 04min')
  })

  it('formats multi-hour durations', () => {
    expect(formatDuration(125 * 60_000)).toBe('2h 05min')
  })
})

describe('buildPayload', () => {
  const now = () => Date.parse('2026-07-15T10:00:00.000Z')

  it('builds an end payload naming the correct event and project', () => {
    const payload = buildPayload(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { now }
    )

    expect(payload.metadata.event).toBe('end')
    expect(payload.metadata.project).toBe('my-project')
    expect(payload.metadata.timestamp).toBe('2026-07-15T10:00:00.000Z')
  })

  it('builds a start payload', () => {
    const payload = buildPayload(
      { hook_event_name: 'UserPromptSubmit', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { now }
    )

    expect(payload.metadata.event).toBe('start')
    expect(payload.message).toBe('Task started')
  })

  it('builds a needs-input payload with a "Projeto:" line ahead of the hook message', () => {
    const payload = buildPayload(
      {
        hook_event_name: 'Notification',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId(),
        message: 'Claude needs your permission to run a command'
      },
      { now }
    )

    expect(payload.metadata.event).toBe('needs-input')
    expect(payload.title).toBe('🙋 my-project — precisa de você')
    expect(payload.message).toBe('Projeto: my-project\nClaude needs your permission to run a command')
    expect(payload.priority).toBe('high')
  })

  it('uses a generic fallback message for needs-input when the hook gives none', () => {
    const payload = buildPayload(
      { hook_event_name: 'Notification', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { now }
    )
    expect(payload.message).toContain('Projeto: my-project')
  })

  it('builds a "done" end payload with only the end time when no start was cached', () => {
    const payload = buildPayload(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { now }
    )

    expect(payload.title).toBe('✅ my-project — concluído')
    expect(payload.message).toBe(`Fim ${formatLocalTime(now())}`)
    expect(payload.priority).toBe('default')
  })

  it('includes Início/Fim/duration in the body when a start time was cached', () => {
    const sessionId = freshSessionId()
    const startMs = Date.parse('2026-07-15T09:48:00.000Z')
    writeFileSync(startCachePath(sessionId), String(startMs), 'utf8')

    const payload = buildPayload(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: sessionId },
      { now }
    )

    expect(payload.message).toBe(
      `Início ${formatLocalTime(startMs)} · Fim ${formatLocalTime(now())} (12min)`
    )
    expect(payload.metadata.durationMs).toBe(now() - startMs)
  })

  it('appends the headline after the time line when a transcript is available', () => {
    const sessionId = freshSessionId()
    const transcriptPath = join(makeTempDir('notify-hub-hook-test-transcript-'), 'transcript.jsonl')
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'assistant', message: { content: 'All changes are done.\n\nReady for review.' } })}\n`,
      'utf8'
    )

    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: sessionId,
        transcript_path: transcriptPath
      },
      { now }
    )

    expect(payload.message).toBe(`Fim ${formatLocalTime(now())}\n\nAll changes are done.`)
    expect(payload.title).toBe('✅ my-project — concluído')
  })

  it('classifies as a pending decision when the transcript ends in a question', () => {
    const sessionId = freshSessionId()
    const transcriptPath = join(makeTempDir('notify-hub-hook-test-transcript-'), 'transcript.jsonl')
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'assistant', message: { content: 'Implemented the feature.\n\nShould I open the PR now?' } })}\n`,
      'utf8'
    )

    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: sessionId,
        transcript_path: transcriptPath
      },
      { now }
    )

    expect(payload.title).toBe('🤔 my-project — aguardando sua decisão')
  })

  it('omits the message summary when no transcript_path is given', () => {
    const payload = buildPayload(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { now }
    )
    expect(payload.message).toBe(`Fim ${formatLocalTime(now())}`)
  })

  it('omits the message summary when transcript_path points to a missing file', () => {
    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId(),
        transcript_path: '/nonexistent/path/transcript.jsonl'
      },
      { now }
    )
    expect(payload.message).toBe(`Fim ${formatLocalTime(now())}`)
  })

  it('omits durationMs when no start-time was cached for the session', () => {
    const payload = buildPayload(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { now }
    )
    expect(payload.metadata).not.toHaveProperty('durationMs')
  })

  it('caps the end body length to ~400 chars even with a very long headline source', () => {
    const sessionId = freshSessionId()
    const transcriptPath = join(makeTempDir('notify-hub-hook-test-transcript-'), 'transcript.jsonl')
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(1000) } })}\n`,
      'utf8'
    )

    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: sessionId,
        transcript_path: transcriptPath
      },
      { now }
    )

    expect(payload.message.length).toBeLessThanOrEqual(400)
  })

  it('resolves the project name via the real git toplevel for an actual repo', () => {
    const repoDir = makeTempDir('notify-hub-hook-test-repo-')
    runGit(['init', '-q'], repoDir)

    const payload = buildPayload(
      { hook_event_name: 'Stop', cwd: repoDir, session_id: freshSessionId() },
      { now }
    )

    expect(payload.metadata.project).toBe(basename(repoDir))
    expect(payload.title).toBe(`✅ ${basename(repoDir)} — concluído`)
  })
})

describe('run', () => {
  const now = () => 1_000

  it('POSTs the built payload with bearer auth when the toggle is enabled', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      {
        fetch: fetchImpl,
        env: {
          NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
          NOTIFY_URL: 'http://localhost:8080/notify',
          NOTIFY_TOKEN: 'sekret',
          NOTIFY_IDLE_SECONDS: '0'
        },
        now
      }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:8080/notify')
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].options.headers.authorization).toBe('Bearer sekret')
    const body = JSON.parse(calls[0].options.body)
    expect(body.metadata.event).toBe('end')
    expect(body.metadata.project).toBe('my-project')
  })

  it('does not send a start push by default (opt-in now) but still caches the start time', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }
    const sessionId = freshSessionId()

    await run(
      { hook_event_name: 'UserPromptSubmit', cwd: '/Users/dev/my-project', session_id: sessionId },
      {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
        now
      }
    )

    expect(calls).toHaveLength(0)
    expect(existsSync(startCachePath(sessionId))).toBe(true)
  })

  it('sends a start push when NOTIFY_ON_START is explicitly "true"', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'UserPromptSubmit', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      {
        fetch: fetchImpl,
        env: {
          NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
          NOTIFY_URL: 'http://localhost:8080/notify',
          NOTIFY_ON_START: 'true'
        },
        now
      }
    )

    expect(calls).toHaveLength(1)
  })

  it('does not call fetch when the needs-input toggle is disabled', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      {
        hook_event_name: 'Notification',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId(),
        message: 'needs input'
      },
      {
        fetch: fetchImpl,
        env: {
          NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
          NOTIFY_URL: 'http://localhost:8080/notify',
          NOTIFY_ON_NEEDS_INPUT: 'false'
        },
        now
      }
    )

    expect(calls).toHaveLength(0)
  })

  it('resolves without throwing when fetch throws (network error)', async () => {
    const fetchImpl = async () => {
      throw new Error('network unreachable')
    }

    await expect(
      run(
        { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
        {
          fetch: fetchImpl,
          env: {
            NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
            NOTIFY_URL: 'http://localhost:8080/notify',
            NOTIFY_IDLE_SECONDS: '0'
          },
          now
        }
      )
    ).resolves.toBeUndefined()
  })

  it('resolves without throwing when the gateway responds non-2xx', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 })

    await expect(
      run(
        { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
        {
          fetch: fetchImpl,
          env: {
            NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
            NOTIFY_URL: 'http://localhost:8080/notify',
            NOTIFY_IDLE_SECONDS: '0'
          },
          now
        }
      )
    ).resolves.toBeUndefined()
  })

  it('resolves without calling fetch when neither env nor the config file has NOTIFY_URL', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { fetch: fetchImpl, env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH }, now }
    )

    expect(calls).toHaveLength(0)
  })

  it('does not call fetch for an unmapped hook event', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'PreToolUse', cwd: '/Users/dev/my-project' },
      {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
        now
      }
    )

    expect(calls).toHaveLength(0)
  })

  it('falls back to the config file when NOTIFY_URL/NOTIFY_TOKEN are absent from env', async () => {
    const dir = makeTempDir('notify-hub-hook-test-config-')
    const configPath = join(dir, 'hook.env')
    writeFileSync(
      configPath,
      'NOTIFY_URL=http://localhost:8080/notify\nNOTIFY_TOKEN=filetoken\nNOTIFY_ON_END=true\n',
      'utf8'
    )

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { fetch: fetchImpl, env: { NOTIFY_HOOK_CONFIG: configPath, NOTIFY_IDLE_SECONDS: '0' }, now }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:8080/notify')
    expect(calls[0].options.headers.authorization).toBe('Bearer filetoken')
  })

  it('env NOTIFY_URL wins over a conflicting config-file value', async () => {
    const dir = makeTempDir('notify-hub-hook-test-config-')
    const configPath = join(dir, 'hook.env')
    writeFileSync(configPath, 'NOTIFY_URL=http://from-file:9999/notify\n', 'utf8')

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: configPath, NOTIFY_URL: 'http://from-env:8080/notify', NOTIFY_IDLE_SECONDS: '0' },
        now
      }
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://from-env:8080/notify')
  })

  it('a malformed config-file line is ignored while the rest still enables sending', async () => {
    const dir = makeTempDir('notify-hub-hook-test-config-')
    const configPath = join(dir, 'hook.env')
    writeFileSync(
      configPath,
      'this line is not valid\nNOTIFY_URL=http://localhost:8080/notify\nNOTIFY_TOKEN=filetoken\n',
      'utf8'
    )

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: freshSessionId() },
      { fetch: fetchImpl, env: { NOTIFY_HOOK_CONFIG: configPath, NOTIFY_IDLE_SECONDS: '0' }, now }
    )

    expect(calls).toHaveLength(1)
  })
})

// --- Amendment 1 / HOOK-06: idle-debounced end notification ------------------

describe('resolveIdleSeconds', () => {
  it('defaults to 180 when NOTIFY_IDLE_SECONDS is absent', () => {
    expect(resolveIdleSeconds({})).toBe(180)
  })

  it('parses a configured value', () => {
    expect(resolveIdleSeconds({ NOTIFY_IDLE_SECONDS: '30' })).toBe(30)
  })

  it('treats "0" as the legacy immediate-send opt-out', () => {
    expect(resolveIdleSeconds({ NOTIFY_IDLE_SECONDS: '0' })).toBe(0)
  })

  it('falls back to the default for a non-numeric value', () => {
    expect(resolveIdleSeconds({ NOTIFY_IDLE_SECONDS: 'not-a-number' })).toBe(180)
  })

  it('falls back to the default for a negative value', () => {
    expect(resolveIdleSeconds({ NOTIFY_IDLE_SECONDS: '-5' })).toBe(180)
  })
})

describe('shouldDeferredSend (truth table)', () => {
  it('does not send when activity is newer than this Stop (user came back)', () => {
    expect(
      shouldDeferredSend({ activityTs: 2_000, pendingStopTs: 1_000, myStopTs: 1_000 })
    ).toBe(false)
  })

  it('does not send when the pending entry belongs to a newer Stop (superseded)', () => {
    expect(
      shouldDeferredSend({ activityTs: undefined, pendingStopTs: 2_000, myStopTs: 1_000 })
    ).toBe(false)
  })

  it('does not send when the pending entry is missing', () => {
    expect(
      shouldDeferredSend({ activityTs: undefined, pendingStopTs: undefined, myStopTs: 1_000 })
    ).toBe(false)
  })

  it('sends when there is no newer activity and the pending entry matches this Stop', () => {
    expect(
      shouldDeferredSend({ activityTs: undefined, pendingStopTs: 1_000, myStopTs: 1_000 })
    ).toBe(true)
  })

  it('sends when the last activity is at or before this Stop', () => {
    expect(
      shouldDeferredSend({ activityTs: 1_000, pendingStopTs: 1_000, myStopTs: 1_000 })
    ).toBe(true)
  })
})

describe('run: Stop debounce (NOTIFY_IDLE_SECONDS > 0)', () => {
  const now = () => 5_000

  it('does not call fetch, writes a pending file, and spawns a detached sender', async () => {
    const fetchCalls = []
    const fetchImpl = async (url, options) => {
      fetchCalls.push({ url, options })
      return { ok: true, status: 202 }
    }
    const spawnCalls = []
    const spawnImpl = (command, args, options) => {
      spawnCalls.push({ command, args, options })
      return { unref: () => {} }
    }
    const sessionId = freshSessionId()

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: sessionId },
      {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
        now,
        spawn: spawnImpl
      }
    )

    expect(fetchCalls).toHaveLength(0)

    expect(existsSync(pendingPayloadPath(sessionId))).toBe(true)
    const pending = JSON.parse(readFileSync(pendingPayloadPath(sessionId), 'utf8'))
    expect(pending.stopTs).toBe(now())
    expect(pending.payload.metadata.event).toBe('end')
    expect(pending.payload.metadata.project).toBe('my-project')

    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].args[1]).toBe('--deferred-send')
    expect(spawnCalls[0].args[2]).toBe(sessionId)
    expect(spawnCalls[0].args[3]).toBe(String(now()))
    expect(spawnCalls[0].options.detached).toBe(true)
    expect(spawnCalls[0].options.stdio).toBe('ignore')
  })

  it('a newer Stop overwrites the pending entry (stopTs updated) and spawns again', async () => {
    const fetchImpl = async () => ({ ok: true, status: 202 })
    const spawnCalls = []
    const spawnImpl = (command, args) => {
      spawnCalls.push(args)
      return { unref: () => {} }
    }
    const sessionId = freshSessionId()
    const env = { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' }

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: sessionId },
      { fetch: fetchImpl, env, now: () => 1_000, spawn: spawnImpl }
    )
    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: sessionId },
      { fetch: fetchImpl, env, now: () => 2_000, spawn: spawnImpl }
    )

    const pending = JSON.parse(readFileSync(pendingPayloadPath(sessionId), 'utf8'))
    expect(pending.stopTs).toBe(2_000)
    expect(spawnCalls).toHaveLength(2)
    expect(spawnCalls[0][3]).toBe('1000')
    expect(spawnCalls[1][3]).toBe('2000')
  })
})

describe('run: Stop legacy immediate send (NOTIFY_IDLE_SECONDS = 0)', () => {
  it('POSTs immediately and never writes a pending file', async () => {
    const fetchCalls = []
    const fetchImpl = async (url, options) => {
      fetchCalls.push({ url, options })
      return { ok: true, status: 202 }
    }
    const sessionId = freshSessionId()

    await run(
      { hook_event_name: 'Stop', cwd: '/Users/dev/my-project', session_id: sessionId },
      {
        fetch: fetchImpl,
        env: {
          NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
          NOTIFY_URL: 'http://localhost:8080/notify',
          NOTIFY_IDLE_SECONDS: '0'
        },
        now: () => 9_000,
        spawn: noopSpawn
      }
    )

    expect(fetchCalls).toHaveLength(1)
    expect(existsSync(pendingPayloadPath(sessionId))).toBe(false)
  })
})

describe('run: UserPromptSubmit refreshes the activity marker', () => {
  it('writes/refreshes the activity file regardless of the start-push toggle', async () => {
    const fetchImpl = async () => ({ ok: true, status: 202 })
    const sessionId = freshSessionId()

    await run(
      { hook_event_name: 'UserPromptSubmit', cwd: '/Users/dev/my-project', session_id: sessionId },
      {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
        now: () => 4_242
      }
    )

    expect(existsSync(activityCachePath(sessionId))).toBe(true)
    expect(readFileSync(activityCachePath(sessionId), 'utf8')).toBe('4242')
  })
})

describe('run: Notification always sends immediately, even with idle debounce on', () => {
  it('calls fetch right away without writing a pending file or spawning', async () => {
    const fetchCalls = []
    const fetchImpl = async (url, options) => {
      fetchCalls.push({ url, options })
      return { ok: true, status: 202 }
    }
    const spawnCalls = []
    const spawnImpl = (...args) => {
      spawnCalls.push(args)
      return { unref: () => {} }
    }
    const sessionId = freshSessionId()

    await run(
      {
        hook_event_name: 'Notification',
        cwd: '/Users/dev/my-project',
        session_id: sessionId,
        message: 'needs input'
      },
      {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
        now: () => 1_000,
        spawn: spawnImpl
      }
    )

    expect(fetchCalls).toHaveLength(1)
    expect(spawnCalls).toHaveLength(0)
    expect(existsSync(pendingPayloadPath(sessionId))).toBe(false)
  })
})

describe('runDeferredSend (integration-ish: real decision logic, injected sleep)', () => {
  const instantSleep = async () => {}

  it('cancels when a newer activity marker exists (user came back)', async () => {
    const sessionId = freshSessionId()
    const stopTs = 1_000
    writeFileSync(pendingPayloadPath(sessionId), JSON.stringify({ stopTs, payload: { title: 'x' } }), 'utf8')
    writeFileSync(activityCachePath(sessionId), '2000', 'utf8')

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await runDeferredSend(sessionId, stopTs, {
      fetch: fetchImpl,
      env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
      sleep: instantSleep
    })

    expect(calls).toHaveLength(0)
    // Cancellation never touches the pending file -- it may belong to a
    // still-running deferred sender for a subsequent Stop.
    expect(existsSync(pendingPayloadPath(sessionId))).toBe(true)
  })

  it('cancels when the pending entry has been superseded by a newer Stop', async () => {
    const sessionId = freshSessionId()
    const staleStopTs = 1_000
    // A newer Stop already overwrote the pending file with its own stopTs.
    writeFileSync(
      pendingPayloadPath(sessionId),
      JSON.stringify({ stopTs: 2_000, payload: { title: 'newest' } }),
      'utf8'
    )

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await runDeferredSend(sessionId, staleStopTs, {
      fetch: fetchImpl,
      env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
      sleep: instantSleep
    })

    expect(calls).toHaveLength(0)
    // Must not delete the newer pending entry that belongs to another sender.
    expect(existsSync(pendingPayloadPath(sessionId))).toBe(true)
    const remaining = JSON.parse(readFileSync(pendingPayloadPath(sessionId), 'utf8'))
    expect(remaining.stopTs).toBe(2_000)
  })

  it('sends the saved payload and deletes the pending file when this is still the freshest Stop', async () => {
    const sessionId = freshSessionId()
    const stopTs = 1_000
    const payload = { title: '✅ my-project — concluído', message: 'Fim 10:00', priority: 'default' }
    writeFileSync(pendingPayloadPath(sessionId), JSON.stringify({ stopTs, payload }), 'utf8')

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await runDeferredSend(sessionId, stopTs, {
      fetch: fetchImpl,
      env: {
        NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH,
        NOTIFY_URL: 'http://localhost:8080/notify',
        NOTIFY_TOKEN: 'sekret'
      },
      sleep: instantSleep
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:8080/notify')
    expect(calls[0].options.headers.authorization).toBe('Bearer sekret')
    expect(JSON.parse(calls[0].options.body)).toEqual(payload)
    expect(existsSync(pendingPayloadPath(sessionId))).toBe(false)
  })

  it('sends without a prior activity marker at all (the common case: no UserPromptSubmit since Stop)', async () => {
    const sessionId = freshSessionId()
    const stopTs = 1_000
    const payload = { title: '✅ my-project — concluído', message: 'Fim 10:00', priority: 'default' }
    writeFileSync(pendingPayloadPath(sessionId), JSON.stringify({ stopTs, payload }), 'utf8')

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await runDeferredSend(sessionId, stopTs, {
      fetch: fetchImpl,
      env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH, NOTIFY_URL: 'http://localhost:8080/notify' },
      sleep: instantSleep
    })

    expect(calls).toHaveLength(1)
    expect(existsSync(activityCachePath(sessionId))).toBe(false)
  })

  it('resolves without throwing and skips the send when NOTIFY_URL is unset', async () => {
    const sessionId = freshSessionId()
    const stopTs = 1_000
    writeFileSync(pendingPayloadPath(sessionId), JSON.stringify({ stopTs, payload: { title: 'x' } }), 'utf8')

    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await expect(
      runDeferredSend(sessionId, stopTs, {
        fetch: fetchImpl,
        env: { NOTIFY_HOOK_CONFIG: MISSING_CONFIG_PATH },
        sleep: instantSleep
      })
    ).resolves.toBeUndefined()

    expect(calls).toHaveLength(0)
    // Still the freshest Stop, so the (unsendable) pending entry is cleared.
    expect(existsSync(pendingPayloadPath(sessionId))).toBe(false)
  })
})
