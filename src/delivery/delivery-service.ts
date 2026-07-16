/**
 * Delivery service (spec DBCH-05, hot-reload): sends one notification via
 * one named channel INSTANCE and produces its DeliveryResult. The instance
 * is loaded from the ChannelRepository at DELIVERY TIME (read-through), so a
 * panel edit to the instance's config/enabled flag takes effect on the very
 * next send with no process restart. The adapter is then built per delivery
 * via the type registry (buildInstance) and sent through.
 *
 * A missing (deleted) or disabled instance is a logged no-op skip that
 * RESOLVES -- the job completes without a retry, and other channels are
 * unaffected (partial-failure isolation lives in the queue/dispatch layer;
 * this service only ever touches one instance per call). A send failure is
 * logged as a failing DeliveryResult and re-thrown so the real queue
 * (BullMQ) retries per its configured attempts/backoff.
 */
import type { Clock, ChannelRepository, Logger } from '../core/ports.js'
import type { ChannelDeps, DeliveryJob, DeliveryResult } from '../core/types.js'
import { buildInstance } from '../channels/build-instance.js'

export interface DeliveryServiceDeps {
  channelRepo: ChannelRepository
  channelDeps: ChannelDeps
  clock: Clock
  logger: Logger
}

export class DeliveryService {
  constructor(private readonly deps: DeliveryServiceDeps) {}

  /**
   * Loads `job.channel` (an instance id) from the repository, builds the
   * adapter from its current config, and sends. Returns a DeliveryResult
   * whose `channel` is the instance id. On a missing/disabled instance,
   * warns and resolves a skipped result (attempts: 0) without sending. On
   * send failure, logs the failing result and re-throws for queue retry.
   */
  async deliver(job: DeliveryJob): Promise<DeliveryResult> {
    const instance = this.deps.channelRepo.get(job.channel)

    if (!instance || !instance.enabled) {
      this.deps.logger.warn(
        { channel: job.channel, reason: instance ? 'disabled' : 'not-found' },
        `delivery skipped for instance "${job.channel}" (missing or disabled)`
      )
      return { channel: job.channel, ok: true, attempts: 0, durationMs: 0 }
    }

    const channel = buildInstance(instance, this.deps.channelDeps)
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
        `delivery failed for instance "${job.channel}"`
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
