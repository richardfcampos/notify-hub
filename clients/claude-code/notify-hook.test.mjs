/**
 * Tests derive from spec NOTIF-13 ACs and T20's "Done when": event
 * mapping, payload shape/field values, env-toggle gating (fetch not
 * called when disabled), exit-0-on-error behavior (`run` never throws),
 * and best-effort omission of transcript/start-time fields when
 * unavailable. No real network call is ever made -- `fetch` is injected
 * as a fake in every `run()` test.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPayload, mapEvent, run } from './notify-hook.mjs'

const createdSessionIds = []

function freshSessionId() {
  const id = `test-${randomUUID()}`
  createdSessionIds.push(id)
  return id
}

afterEach(() => {
  // Best-effort cleanup of any start-time cache files this test wrote.
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop()
    const path = join(tmpdir(), `notify-hub-${id}.start`)
    if (existsSync(path)) {
      unlinkSync(path)
    }
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

describe('buildPayload', () => {
  const now = () => Date.parse('2026-07-15T10:00:00.000Z')

  it('builds an end payload naming the correct event and project', () => {
    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      { now }
    )

    expect(payload.metadata.event).toBe('end')
    expect(payload.metadata.project).toBe('my-project')
    expect(payload.metadata.timestamp).toBe('2026-07-15T10:00:00.000Z')
  })

  it('builds a start payload', () => {
    const payload = buildPayload(
      {
        hook_event_name: 'UserPromptSubmit',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      { now }
    )

    expect(payload.metadata.event).toBe('start')
  })

  it('builds a needs-input payload using hookInput.message as the message', () => {
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
    expect(payload.message).toBe('Claude needs your permission to run a command')
  })

  it('omits the message summary when no transcript_path is given', () => {
    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      { now }
    )

    expect(payload.message).toBe('Task finished')
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

    expect(payload.message).toBe('Task finished')
  })

  it('omits durationMs when no start-time was cached for the session', () => {
    const payload = buildPayload(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      { now }
    )

    expect(payload.metadata).not.toHaveProperty('durationMs')
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
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      {
        fetch: fetchImpl,
        env: { NOTIFY_URL: 'http://localhost:8080/notify', NOTIFY_TOKEN: 'sekret' },
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

  it('does not call fetch when the start toggle is disabled', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      {
        hook_event_name: 'UserPromptSubmit',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      {
        fetch: fetchImpl,
        env: { NOTIFY_URL: 'http://localhost:8080/notify', NOTIFY_ON_START: 'false' },
        now
      }
    )

    expect(calls).toHaveLength(0)
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
        {
          hook_event_name: 'Stop',
          cwd: '/Users/dev/my-project',
          session_id: freshSessionId()
        },
        {
          fetch: fetchImpl,
          env: { NOTIFY_URL: 'http://localhost:8080/notify' },
          now
        }
      )
    ).resolves.toBeUndefined()
  })

  it('resolves without throwing when the gateway responds non-2xx', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 })

    await expect(
      run(
        {
          hook_event_name: 'Stop',
          cwd: '/Users/dev/my-project',
          session_id: freshSessionId()
        },
        {
          fetch: fetchImpl,
          env: { NOTIFY_URL: 'http://localhost:8080/notify' },
          now
        }
      )
    ).resolves.toBeUndefined()
  })

  it('resolves without calling fetch when NOTIFY_URL is not configured', async () => {
    const calls = []
    const fetchImpl = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 202 }
    }

    await run(
      {
        hook_event_name: 'Stop',
        cwd: '/Users/dev/my-project',
        session_id: freshSessionId()
      },
      { fetch: fetchImpl, env: {}, now }
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
        env: { NOTIFY_URL: 'http://localhost:8080/notify' },
        now
      }
    )

    expect(calls).toHaveLength(0)
  })
})
