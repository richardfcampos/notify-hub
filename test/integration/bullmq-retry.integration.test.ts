/**
 * Redis-backed integration test for the REAL BullMqQueue (spec NOTIF-02.2
 * retry/backoff, NOTIF-02.3 dead-letter, and the best-effort dedup edge
 * case). Unlike the fan-out suite -- which drives an InMemoryQueue double --
 * this exercises the production queue against a REAL Redis so the retry
 * exhaustion and failed-set landing are asserted on actual BullMQ state, not
 * a stand-in.
 *
 * Redis source: an ephemeral `redis:7-alpine` started via testcontainers,
 * OR `process.env.REDIS_TEST_URL` when set (CI / docker-compose fallback).
 * Each BullMqQueue gets a unique key prefix so the three tests can share one
 * Redis without their queues bleeding into each other.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GenericContainer, type StartedTestContainer } from 'testcontainers'
import { BullMqQueue } from '../../src/queue/bullmq-queue.js'
import type { DeliveryJob, Notification } from '../../src/core/types.js'

// Explicit cleanup happens in afterAll, so the Ryuk reaper (an extra image
// pull) is unnecessary here -- disable it to keep the test offline-friendly.
process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true'

const CONTAINER_STARTUP_MS = 120_000
const TEST_TIMEOUT_MS = 30_000

const notification: Notification = { title: 'Build', message: 'done' }
const deliveryJob = (): DeliveryJob => ({
  notification,
  channel: 'ntfy',
  dispatchJobId: randomUUID()
})

/** Poll `read` until `done` is true or the deadline passes (then throw). */
async function waitUntil<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 15_000, intervalMs = 40 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) {
      throw new Error('waitUntil: condition not met before timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

describe('BullMqQueue retry, dead-letter, and dedup against real Redis', () => {
  let container: StartedTestContainer | undefined
  let redisUrl: string
  const queues: BullMqQueue[] = []

  /** Build a queue with a unique prefix and register it for teardown. */
  function makeQueue(retry: { attempts: number; backoffMs: number }): BullMqQueue {
    const queue = new BullMqQueue({ redisUrl, retry, prefix: `test-${randomUUID()}` })
    queues.push(queue)
    return queue
  }

  beforeAll(async () => {
    const envUrl = process.env.REDIS_TEST_URL
    if (envUrl) {
      redisUrl = envUrl
      return
    }
    container = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start()
    redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
  }, CONTAINER_STARTUP_MS)

  afterAll(async () => {
    await Promise.all(queues.map((queue) => queue.close().catch(() => undefined)))
    if (container) {
      await container.stop()
    }
  })

  it(
    'retries up to `attempts` then dead-letters the exhausted job (NOTIF-02.2/02.3)',
    async () => {
      const queue = makeQueue({ attempts: 2, backoffMs: 50 })
      let handlerCalls = 0
      queue.onDelivery(async () => {
        handlerCalls += 1
        throw new Error('permanent channel failure')
      })

      await queue.enqueueDelivery(deliveryJob())

      // Retries exhausted -> the job lands in the failed set (removeOnFail:false),
      // it is NOT silently dropped.
      const failed = await waitUntil(
        () => queue.getFailedDeliveryJobs(),
        (jobs) => jobs.length === 1
      )

      expect(failed).toHaveLength(1)
      // Two total attempts were made (initial + one retry) -- backoff applied.
      expect(failed[0]?.attemptsMade).toBe(2)
      expect(handlerCalls).toBe(2)
      expect(failed[0]?.failedReason).toContain('permanent channel failure')
    },
    TEST_TIMEOUT_MS
  )

  it(
    'retries a transient failure and ultimately completes (not dead-lettered)',
    async () => {
      const queue = makeQueue({ attempts: 2, backoffMs: 50 })
      let handlerCalls = 0
      queue.onDelivery(async () => {
        handlerCalls += 1
        if (handlerCalls === 1) {
          throw new Error('transient blip')
        }
        // Second attempt succeeds.
      })

      await queue.enqueueDelivery(deliveryJob())

      // The second attempt succeeds, so the job completes and is never parked
      // in the failed set.
      await waitUntil(
        () => Promise.resolve(handlerCalls),
        (calls) => calls >= 2
      )
      expect(handlerCalls).toBe(2)
      const failed = await queue.getFailedDeliveryJobs()
      expect(failed).toHaveLength(0)
    },
    TEST_TIMEOUT_MS
  )

  it(
    'collapses two dispatch jobs sharing a dedupKey into a single job',
    async () => {
      const queue = makeQueue({ attempts: 2, backoffMs: 50 })
      // No dispatch worker registered -> jobs stay in the waiting state so
      // the collapse is observable via the waiting count.
      const dedupKey = `dedup-${randomUUID()}`

      const first = await queue.enqueueDispatch({
        notification,
        profileName: 'phone',
        dedupKey
      })
      const second = await queue.enqueueDispatch({
        notification,
        profileName: 'phone',
        dedupKey
      })

      // Same jobId returned for both -> the second add collapsed onto the first.
      expect(first.jobId).toBe(dedupKey)
      expect(second.jobId).toBe(dedupKey)
      expect(await queue.getWaitingDispatchCount()).toBe(1)
    },
    TEST_TIMEOUT_MS
  )
})
