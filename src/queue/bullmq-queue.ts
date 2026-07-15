/**
 * Production QueuePort implementation over BullMQ + Redis (spec NOTIF-02).
 * Two named queues -- dispatch and delivery -- each backed by a Worker that
 * invokes the handler registered via onDispatch/onDelivery. Retry/backoff
 * comes from BullMQ job options (attempts + exponential backoff, spec
 * NOTIF-02.2); `removeOnFail: false` keeps a job whose retries are
 * exhausted in the failed set as the dead-letter (spec NOTIF-02.3) instead
 * of dropping it. Retry and dead-letter behavior is verified against a real
 * Redis by test/integration/bullmq-retry.integration.test.ts.
 */
import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { Redis } from 'ioredis'
import type { QueuePort } from '../core/ports.js'
import type { DeliveryJob, DispatchJob } from '../core/types.js'

const DISPATCH_QUEUE = 'dispatch'
const DELIVERY_QUEUE = 'delivery'

export interface BullMqQueueConfig {
  redisUrl: string
  retry: { attempts: number; backoffMs: number }
  /**
   * BullMQ key prefix namespacing every Redis key. Unset -> BullMQ's own
   * default, so production behavior is unchanged; integration tests pass a
   * unique value per instance to isolate their queues from one another.
   */
  prefix?: string
}

export class BullMqQueue implements QueuePort {
  private readonly connection: Redis
  private readonly dispatchQueue: Queue<DispatchJob>
  private readonly deliveryQueue: Queue<DeliveryJob>
  /** Connection (+ optional prefix) reused for every Queue and Worker. */
  private readonly baseOpts: { connection: Redis; prefix?: string }
  private readonly jobOpts: {
    attempts: number
    backoff: { type: 'exponential'; delay: number }
    removeOnComplete: boolean
    removeOnFail: boolean
  }

  private dispatchWorker: Worker<DispatchJob> | null = null
  private deliveryWorker: Worker<DeliveryJob> | null = null

  constructor(config: BullMqQueueConfig) {
    // maxRetriesPerRequest: null is required by BullMQ workers, which use
    // blocking Redis commands; this one connection is shared by both
    // queues and both workers.
    this.connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null
    })
    this.baseOpts = config.prefix
      ? { connection: this.connection, prefix: config.prefix }
      : { connection: this.connection }
    this.jobOpts = {
      attempts: config.retry.attempts,
      backoff: { type: 'exponential', delay: config.retry.backoffMs },
      removeOnComplete: true,
      removeOnFail: false
    }
    this.dispatchQueue = new Queue<DispatchJob>(DISPATCH_QUEUE, this.baseOpts)
    this.deliveryQueue = new Queue<DeliveryJob>(DELIVERY_QUEUE, this.baseOpts)
  }

  async enqueueDispatch(job: DispatchJob): Promise<{ jobId: string }> {
    // A dedupKey pins the BullMQ jobId, so a client retry of the same logical
    // notification collapses onto the existing job instead of enqueuing a
    // duplicate (spec edge case: best-effort dedup). Absent a dedupKey,
    // BullMQ assigns its own incrementing id -- behavior unchanged.
    const opts = job.dedupKey ? { ...this.jobOpts, jobId: job.dedupKey } : this.jobOpts
    const added = await this.dispatchQueue.add(DISPATCH_QUEUE, job, opts)
    // BullMQ always assigns an id once add() resolves.
    return { jobId: added.id as string }
  }

  async enqueueDelivery(job: DeliveryJob): Promise<{ jobId: string }> {
    const added = await this.deliveryQueue.add(DELIVERY_QUEUE, job, this.jobOpts)
    return { jobId: added.id as string }
  }

  onDispatch(handler: (job: DispatchJob) => Promise<void>): void {
    // A processor that throws lets BullMQ retry per `attempts`, then land
    // the job in the failed set (dead-letter) -- never swallow here.
    this.dispatchWorker = new Worker<DispatchJob>(
      DISPATCH_QUEUE,
      async (job) => handler(job.data),
      this.baseOpts
    )
  }

  onDelivery(handler: (job: DeliveryJob) => Promise<void>): void {
    this.deliveryWorker = new Worker<DeliveryJob>(
      DELIVERY_QUEUE,
      async (job) => handler(job.data),
      this.baseOpts
    )
  }

  /**
   * Read-only view of the delivery queue's failed (dead-letter) set: the
   * jobs whose retries were exhausted and, because removeOnFail is false,
   * parked rather than dropped (spec NOTIF-02.3). Ops/tests introspection
   * only -- each returned Job exposes `attemptsMade` for retry-count checks.
   */
  async getFailedDeliveryJobs(): Promise<Job<DeliveryJob>[]> {
    return this.deliveryQueue.getFailed()
  }

  /** Count of dispatch jobs waiting to be processed -- used to observe dedupKey collapse. */
  async getWaitingDispatchCount(): Promise<number> {
    return this.dispatchQueue.getWaitingCount()
  }

  async health(): Promise<boolean> {
    try {
      return (await this.connection.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await Promise.all([
      this.dispatchWorker?.close(),
      this.deliveryWorker?.close(),
      this.dispatchQueue.close(),
      this.deliveryQueue.close()
    ])
    await this.connection.quit()
  }
}
