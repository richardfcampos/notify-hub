/**
 * Tests derive from T10's Done-when: enqueueDispatch/enqueueDelivery invoke
 * registered handlers with the job and return a jobId; a throwing delivery
 * handler is caught (enqueueDelivery never rejects) and recorded on
 * `deliveries`; health() is always true.
 */
import { describe, expect, it } from 'vitest'
import type { DeliveryJob, DispatchJob } from '../core/types.js'
import { InMemoryQueue } from './in-memory-queue.js'

function makeDispatchJob(overrides: Partial<DispatchJob> = {}): DispatchJob {
  return {
    notification: { title: 't', message: 'm' },
    profileName: 'phone',
    ...overrides
  }
}

function makeDeliveryJob(overrides: Partial<DeliveryJob> = {}): DeliveryJob {
  return {
    notification: { title: 't', message: 'm' },
    channel: 'ntfy',
    dispatchJobId: 'dispatch-1',
    ...overrides
  }
}

describe('InMemoryQueue', () => {
  it('invokes the registered dispatch handler with the enqueued job and returns a jobId', async () => {
    const queue = new InMemoryQueue()
    const received: DispatchJob[] = []
    queue.onDispatch(async (job) => {
      received.push(job)
    })

    const job = makeDispatchJob()
    const result = await queue.enqueueDispatch(job)

    expect(received).toEqual([job])
    expect(typeof result.jobId).toBe('string')
    expect(result.jobId.length).toBeGreaterThan(0)
  })

  it('enqueueDispatch without a registered handler still returns a jobId and does not throw', async () => {
    const queue = new InMemoryQueue()
    const result = await queue.enqueueDispatch(makeDispatchJob())
    expect(typeof result.jobId).toBe('string')
  })

  it('invokes the registered delivery handler with the enqueued job and records ok:true', async () => {
    const queue = new InMemoryQueue()
    const received: DeliveryJob[] = []
    queue.onDelivery(async (job) => {
      received.push(job)
    })

    const job = makeDeliveryJob()
    await queue.enqueueDelivery(job)

    expect(received).toEqual([job])
    expect(queue.deliveries).toEqual([{ channel: 'ntfy', ok: true }])
  })

  it('catches a throwing delivery handler and records {ok:false, error} without the chain throwing', async () => {
    const queue = new InMemoryQueue()
    queue.onDelivery(async () => {
      throw new Error('channel unreachable')
    })

    await expect(
      queue.enqueueDelivery(makeDeliveryJob({ channel: 'slack' }))
    ).resolves.toEqual(
      expect.objectContaining({ jobId: expect.any(String) })
    )

    expect(queue.deliveries).toEqual([
      { channel: 'slack', ok: false, error: 'channel unreachable' }
    ])
  })

  it('health() always resolves true', async () => {
    const queue = new InMemoryQueue()
    await expect(queue.health()).resolves.toBe(true)
  })

  it('close() resolves without throwing', async () => {
    const queue = new InMemoryQueue()
    await expect(queue.close()).resolves.toBeUndefined()
  })
})
