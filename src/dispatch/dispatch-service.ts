/**
 * Dispatch service (spec DBCH-06): resolves the set of named channel
 * INSTANCE ids a DispatchJob should fan out to and enqueues one DeliveryJob
 * per resolved id. Resolution happens AT DISPATCH TIME from the DB:
 * - the enabled set is `channelRepo.listEnabled()` ids;
 * - if the job carries `requestedChannels`, that is the source; otherwise the
 *   source is the job profile's default instance ids (looked up via
 *   `profileRepo.get(job.profileId)` so profile edits hot-reload too);
 * - the source is intersected with the enabled set (order preserved, deduped).
 * An empty resolved set completes as a logged no-op (nothing enqueued).
 * Depends only on the repository ports + QueuePort + Logger, so it stays
 * testable with in-memory fakes.
 */
import { randomUUID } from 'node:crypto'
import type {
  QueuePort,
  Logger,
  ChannelRepository,
  ProfileRepository
} from '../core/ports.js'
import type { DispatchJob } from '../core/types.js'

/**
 * Intersects `requested ?? defaultChannels` with the `enabled` id set,
 * preserving source order and deduping. Pure: the caller supplies the
 * already-resolved default channel ids and enabled set.
 */
export function resolveChannels(
  defaultChannels: string[],
  requested: string[] | undefined,
  enabled: Set<string>
): string[] {
  const source = requested ?? defaultChannels
  const seen = new Set<string>()
  const resolved: string[] = []

  for (const channel of source) {
    if (enabled.has(channel) && !seen.has(channel)) {
      seen.add(channel)
      resolved.push(channel)
    }
  }

  return resolved
}

export interface DispatchServiceDeps {
  queue: QueuePort
  channelRepo: ChannelRepository
  /** Optional: needed only to resolve profile defaults when a job omits requestedChannels. */
  profileRepo?: ProfileRepository
  logger: Logger
}

export class DispatchService {
  constructor(private readonly deps: DispatchServiceDeps) {}

  /**
   * Resolves the instance-id set for `job` from the DB and enqueues one
   * DeliveryJob per resolved id. An empty resolved set completes as a logged
   * no-op -- nothing is enqueued.
   */
  async handleDispatch(job: DispatchJob): Promise<void> {
    const enabled = new Set(this.deps.channelRepo.listEnabled().map((c) => c.id))

    // Only fetch the profile when we actually need its defaults (no requested
    // channels), so the profile repo stays optional for requested-only jobs.
    const defaultChannels = job.requestedChannels
      ? []
      : this.deps.profileRepo?.get(job.profileId)?.defaultChannels ?? []

    const channels = resolveChannels(defaultChannels, job.requestedChannels, enabled)

    if (channels.length === 0) {
      this.deps.logger.warn(
        {
          profileId: job.profileId,
          profileName: job.profileName,
          requestedChannels: job.requestedChannels
        },
        'dispatch resolved to zero enabled instances; completing as a no-op'
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
