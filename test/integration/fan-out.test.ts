/**
 * Fan-out + hot-reload integration test (spec DBCH-05/06, NOTIF-04) over a
 * REAL temp-file SQLite DB and the real SqliteChannel/Profile repositories.
 * Wires a container on an InMemoryQueue with a URL-aware HTTP stub (a webhook
 * whose URL contains "/fail" returns 500) and drives real dispatches:
 * - two instances OF THE SAME TYPE plus one other all deliver, and the one
 *   failing instance does NOT stop the others (partial-failure isolation,
 *   recorded per instance in queue.deliveries);
 * - HOT-RELOAD: editing an instance's config in the DB between sends makes
 *   the next send hit the NEW url with no restart (proven via the stub calls);
 * - a dispatch carrying a dedupKey still fans out to every resolved instance
 *   (dedupKey is a queue-layer concern; it must not suppress the fan-out).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContainer } from '../../src/container.js'
import type { HttpClient } from '../../src/core/ports.js'
import type { AppConfig, ChannelInstance, ProfileRecord } from '../../src/core/types.js'
import { openDatabase } from '../../src/db/database.js'
import { SqliteChannelRepository } from '../../src/db/sqlite-channel-repository.js'
import { SqliteProfileRepository } from '../../src/db/sqlite-profile-repository.js'
import { InMemoryQueue } from '../../src/queue/in-memory-queue.js'
import { FakeLogger, FakeMailTransport } from '../helpers/fakes.js'

/** Records every request; any url containing "/fail" errors with a 500. */
class UrlAwareHttpClient implements HttpClient {
  readonly urls: string[] = []
  async request(opts: { method: string; url: string }): Promise<{ status: number; body: string }> {
    this.urls.push(opts.url)
    return { status: opts.url.includes('/fail') ? 500 : 200, body: 'ok' }
  }
}

const config: AppConfig = {
  port: 3000,
  redisUrl: 'redis://unused',
  dbPath: ':memory:', // unused: repos are injected below
  profiles: [],
  channelsEnabled: [],
  channelConfig: {},
  retry: { attempts: 3, backoffMs: 100 }
}

const slack = (id: string, url: string, enabled = true): ChannelInstance => ({
  id,
  label: id,
  type: 'slack',
  enabled,
  config: { SLACK_WEBHOOK_URL: url }
})

const webhook = (id: string, url: string): ChannelInstance => ({
  id,
  label: id,
  type: 'webhook',
  enabled: true,
  config: { WEBHOOK_URL: url }
})

const phone: ProfileRecord = {
  id: 'phone',
  name: 'phone',
  token: 'tok',
  defaultChannels: ['acme-slack', 'globex-slack', 'ops-webhook']
}

interface Harness {
  channelRepo: SqliteChannelRepository
  http: UrlAwareHttpClient
  queue: InMemoryQueue
  container: ReturnType<typeof buildContainer>
  cleanup: () => void
}

function setup(instances: ChannelInstance[], profiles: ProfileRecord[] = [phone]): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'notify-hub-fanout-'))
  const db = openDatabase(join(dir, 'test.db'))
  const channelRepo = new SqliteChannelRepository(db)
  const profileRepo = new SqliteProfileRepository(db)
  for (const i of instances) channelRepo.upsert(i)
  for (const p of profiles) profileRepo.upsert(p)

  const http = new UrlAwareHttpClient()
  const queue = new InMemoryQueue()
  const container = buildContainer(config, {
    queue,
    channelRepo,
    profileRepo,
    http,
    mail: new FakeMailTransport(),
    logger: new FakeLogger()
  })
  container.registerWorkers()

  return {
    channelRepo,
    http,
    queue,
    container,
    cleanup: () => {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

let active: Harness | null = null
afterEach(() => {
  active?.cleanup()
  active = null
})

describe('fan-out over SQLite with partial-failure isolation', () => {
  it('delivers to two same-type instances + one other; a failing instance does not stop the rest', async () => {
    active = setup([
      slack('acme-slack', 'http://acme.test/fail'), // 500 -> throws
      slack('globex-slack', 'http://globex.test/hook'),
      webhook('ops-webhook', 'http://ops.test/hook')
    ])

    await active.container.queue.enqueueDispatch({
      notification: { title: 'Build', message: 'done' },
      profileId: 'phone'
      // no requestedChannels -> profile defaults ∩ enabled (all three)
    })

    // Fan-out: every resolved instance was actually attempted.
    expect(active.http.urls).toContain('http://acme.test/fail')
    expect(active.http.urls).toContain('http://globex.test/hook')
    expect(active.http.urls).toContain('http://ops.test/hook')

    // Isolation: three per-instance results; only the failing one is not ok.
    expect(active.queue.deliveries).toHaveLength(3)
    const byId = new Map(active.queue.deliveries.map((d) => [d.channel, d]))
    expect(byId.get('acme-slack')?.ok).toBe(false)
    expect(byId.get('acme-slack')?.error).toContain('status 500')
    expect(byId.get('globex-slack')?.ok).toBe(true)
    expect(byId.get('ops-webhook')?.ok).toBe(true)
  })

  it('hot-reloads: editing an instance config in the DB makes the next send hit the new url (no restart)', async () => {
    active = setup([slack('globex-slack', 'http://globex.test/v1')])

    const dispatch = {
      notification: { title: 't', message: 'm' },
      profileId: 'phone',
      requestedChannels: ['globex-slack']
    }

    await active.container.queue.enqueueDispatch(dispatch)

    // Panel edit persisted through the REAL repository: same id, new url.
    active.channelRepo.upsert(slack('globex-slack', 'http://globex.test/v2'))

    await active.container.queue.enqueueDispatch(dispatch)

    expect(active.http.urls).toEqual(['http://globex.test/v1', 'http://globex.test/v2'])
  })

  it('still fans out to every resolved instance when the dispatch carries a dedupKey', async () => {
    active = setup([
      slack('acme-slack', 'http://acme.test/hook'),
      slack('globex-slack', 'http://globex.test/hook')
    ])

    await active.container.queue.enqueueDispatch({
      notification: { title: 't', message: 'm' },
      profileId: 'phone',
      requestedChannels: ['acme-slack', 'globex-slack'],
      dedupKey: 'abc-123'
    })

    expect(active.queue.deliveries.map((d) => d.channel).sort()).toEqual([
      'acme-slack',
      'globex-slack'
    ])
    expect(active.queue.deliveries.every((d) => d.ok)).toBe(true)
  })
})
