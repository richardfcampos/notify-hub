/**
 * Synchronous QueuePort test double: enqueue immediately invokes whichever
 * handler is registered (no timers, no persistence, no Redis) so a whole
 * dispatch -> delivery pipeline can be driven and observed within a single
 * test. A handler that throws is caught here -- it never crashes the
 * enqueue chain. `deliveries` is the observation seam integration tests use
 * to assert partial-failure isolation (spec NOTIF-04).
 */
import { randomUUID } from 'node:crypto'
import type { QueuePort } from '../core/ports.js'
import type { DeliveryJob, DispatchJob } from '../core/types.js'

export interface DeliveryOutcome {
  channel: string
  ok: boolean
  error?: string
}

export class InMemoryQueue implements QueuePort {
  private dispatchHandler: ((job: DispatchJob) => Promise<void>) | null = null
  private deliveryHandler: ((job: DeliveryJob) => Promise<void>) | null = null

  /** Per-delivery outcome, recorded on every enqueueDelivery call once a handler is registered. */
  readonly deliveries: DeliveryOutcome[] = []

  onDispatch(handler: (job: DispatchJob) => Promise<void>): void {
    this.dispatchHandler = handler
  }

  onDelivery(handler: (job: DeliveryJob) => Promise<void>): void {
    this.deliveryHandler = handler
  }

  async enqueueDispatch(job: DispatchJob): Promise<{ jobId: string }> {
    const jobId = randomUUID()
    if (this.dispatchHandler) {
      try {
        await this.dispatchHandler(job)
      } catch {
        // A throwing dispatch handler must not crash the enqueue chain.
        // There is no per-dispatch outcome to record (unlike delivery).
      }
    }
    return { jobId }
  }

  async enqueueDelivery(job: DeliveryJob): Promise<{ jobId: string }> {
    const jobId = randomUUID()
    if (this.deliveryHandler) {
      try {
        await this.deliveryHandler(job)
        this.deliveries.push({ channel: job.channel, ok: true })
      } catch (error) {
        this.deliveries.push({
          channel: job.channel,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return { jobId }
  }

  async health(): Promise<boolean> {
    return true
  }

  async close(): Promise<void> {}
}
