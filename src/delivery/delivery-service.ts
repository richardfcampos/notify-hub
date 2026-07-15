/**
 * Delivery service (spec NOTIF-02, NOTIF-04): sends one notification via
 * one channel strategy and produces its DeliveryResult. Depends only on
 * the built channels map + Clock + Logger (never a concrete adapter), so
 * it stays testable with fakes. A channel throw is logged as a failing
 * DeliveryResult and then re-thrown so the real queue (BullMQ) retries;
 * the queue/dispatch layer is what gives other channels partial-failure
 * isolation -- this service only ever touches one channel per call.
 */
import type { Clock, Logger } from '../core/ports.js'
import type { DeliveryJob, DeliveryResult, NotificationChannel } from '../core/types.js'

export interface DeliveryServiceDeps {
  channels: Map<string, NotificationChannel>
  clock: Clock
  logger: Logger
}

export class DeliveryService {
  constructor(private readonly deps: DeliveryServiceDeps) {}

  /**
   * Looks up `job.channel` in the active channels map and sends through it.
   * Throws immediately if the channel is not active/known. On send success,
   * resolves a DeliveryResult. On send failure, logs the failing
   * DeliveryResult for observability and re-throws the original error so
   * the queue can retry per its configured attempts/backoff.
   */
  async deliver(job: DeliveryJob): Promise<DeliveryResult> {
    const channel = this.deps.channels.get(job.channel)
    if (!channel) {
      throw new Error(`Unknown channel "${job.channel}" is not active`)
    }

    const start = this.deps.clock.now()

    try {
      await channel.send(job.notification)
    } catch (error) {
      const durationMs = this.deps.clock.now() - start
      const message = error instanceof Error ? error.message : String(error)
      const failure: DeliveryResult = {
        channel: job.channel,
        ok: false,
        error: message,
        attempts: 1,
        durationMs
      }
      this.deps.logger.error(
        { ...failure },
        `delivery failed for channel "${job.channel}"`
      )
      throw error
    }

    return {
      channel: job.channel,
      ok: true,
      attempts: 1,
      durationMs: this.deps.clock.now() - start
    }
  }
}
