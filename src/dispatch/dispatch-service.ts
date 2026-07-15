/**
 * Dispatch service (spec NOTIF-03): resolves the channel set for a
 * DispatchJob and fans it out into one DeliveryJob per resolved channel.
 * Depends only on QueuePort + Logger (never a concrete channel/adapter),
 * so it stays testable with InMemoryQueue + FakeLogger.
 */
import { randomUUID } from 'node:crypto'
import type { QueuePort, Logger } from '../core/ports.js'
import type { DispatchJob, Profile } from '../core/types.js'

/**
 * Resolves which channels a dispatch job should fan out to:
 * - `requested` given -> requested ∩ active (order preserved, deduped)
 * - `requested` omitted -> profile.defaultChannels ∩ active (order preserved, deduped)
 */
export function resolveChannels(
  profile: Profile,
  requested: string[] | undefined,
  active: Set<string>
): string[] {
  const source = requested ?? profile.defaultChannels
  const seen = new Set<string>()
  const resolved: string[] = []

  for (const channel of source) {
    if (active.has(channel) && !seen.has(channel)) {
      seen.add(channel)
      resolved.push(channel)
    }
  }

  return resolved
}

export interface DispatchServiceDeps {
  queue: QueuePort
  logger: Logger
  activeChannels: Set<string>
  resolveProfile: (name: string) => Profile
}

export class DispatchService {
  constructor(private readonly deps: DispatchServiceDeps) {}

  /**
   * Resolves the channel set for `job` and enqueues one DeliveryJob per
   * resolved channel. An empty resolved set completes as a logged no-op
   * (spec NOTIF-03.4) -- nothing is enqueued.
   */
  async handleDispatch(job: DispatchJob): Promise<void> {
    const profile = this.deps.resolveProfile(job.profileName)
    const channels = resolveChannels(
      profile,
      job.requestedChannels,
      this.deps.activeChannels
    )

    if (channels.length === 0) {
      this.deps.logger.warn(
        { profileName: job.profileName, requestedChannels: job.requestedChannels },
        'dispatch resolved to zero channels; completing as a no-op'
      )
      return
    }

    // Shared across every delivery job spawned from this one dispatch call,
    // so logs/traces can correlate the fan-out back to its origin.
    const dispatchJobId = randomUUID()

    for (const channel of channels) {
      await this.deps.queue.enqueueDelivery({
        notification: job.notification,
        channel,
        dispatchJobId
      })
    }
  }
}
