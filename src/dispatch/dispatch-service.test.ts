/**
 * Tests derive from spec DBCH-06 (dispatch resolves instance ids ∩ enabled):
 * requested∩enabled (override), profile-default∩enabled (fallback), plain
 * intersection filtering, an empty resolved set -> no-op + warn, and the
 * same-type-multiple-instances fan-out (two enabled slack instances both get
 * their own delivery job). Enabled instances come from a FakeChannelRepository
 * and profile defaults from a FakeProfileRepository, resolved at dispatch time.
 * Uses InMemoryQueue to observe the exact enqueued jobs -- no real queue.
 */
import { describe, expect, it } from 'vitest'
import {
  FakeChannelRepository,
  FakeLogger,
  FakeProfileRepository
} from '../../test/helpers/fakes.js'
import type {
  ChannelInstance,
  DeliveryJob,
  DispatchJob,
  ProfileRecord
} from '../core/types.js'
import { InMemoryQueue } from '../queue/in-memory-queue.js'
import { DispatchService, resolveChannels } from './dispatch-service.js'

const channel = (id: string, type: string, enabled = true): ChannelInstance => ({
  id,
  label: id,
  type,
  enabled,
  config: {}
})

const profile: ProfileRecord = {
  id: 'phone',
  name: 'phone',
  token: 'secret',
  defaultChannels: ['ntfy', 'telegram']
}

describe('resolveChannels', () => {
  it('intersects requested with enabled, preserving order and deduping', () => {
    const enabled = new Set(['ntfy', 'telegram', 'discord'])
    const resolved = resolveChannels(
      profile.defaultChannels,
      ['discord', 'ntfy', 'discord', 'slack'],
      enabled
    )
    expect(resolved).toEqual(['discord', 'ntfy'])
  })

  it('falls back to the default channels ∩ enabled when requested is omitted', () => {
    const enabled = new Set(['ntfy', 'discord'])
    const resolved = resolveChannels(profile.defaultChannels, undefined, enabled)
    expect(resolved).toEqual(['ntfy'])
  })

  it('filters out requested instances that are not enabled/unknown', () => {
    const enabled = new Set(['ntfy'])
    const resolved = resolveChannels(profile.defaultChannels, ['bogus', 'ntfy'], enabled)
    expect(resolved).toEqual(['ntfy'])
  })

  it('returns an empty array when nothing in the source is enabled', () => {
    const enabled = new Set(['discord'])
    const resolved = resolveChannels(profile.defaultChannels, ['ntfy', 'slack'], enabled)
    expect(resolved).toEqual([])
  })
})

describe('DispatchService.handleDispatch', () => {
  function makeService(instances: ChannelInstance[], profiles: ProfileRecord[] = [profile]) {
    const queue = new InMemoryQueue()
    const logger = new FakeLogger()
    const service = new DispatchService({
      queue,
      channelRepo: new FakeChannelRepository(instances),
      profileRepo: new FakeProfileRepository(profiles),
      logger
    })
    const recorded: DeliveryJob[] = []
    queue.onDelivery(async (job) => {
      recorded.push(job)
    })
    return { queue, logger, service, recorded }
  }

  it('enqueues one delivery job per requested instance id (override), skipping disabled ones', async () => {
    const { service, recorded } = makeService([
      channel('ntfy', 'ntfy'),
      channel('telegram', 'telegram'),
      channel('discord', 'discord', false) // disabled -> excluded even if requested
    ])

    const job: DispatchJob = {
      notification: { title: 'Build finished', message: 'All tests passed' },
      profileId: 'phone',
      requestedChannels: ['ntfy', 'discord']
    }
    await service.handleDispatch(job)

    expect(recorded.map((j) => j.channel)).toEqual(['ntfy'])
    expect(recorded[0].notification).toEqual(job.notification)
    expect(typeof recorded[0].dispatchJobId).toBe('string')
  })

  it('falls back to the profile default instance ids ∩ enabled when the job omits requestedChannels', async () => {
    const { service, recorded } = makeService([
      channel('ntfy', 'ntfy'),
      channel('telegram', 'telegram')
    ])

    await service.handleDispatch({
      notification: { title: 't', message: 'm' },
      profileId: 'phone'
    })

    expect(recorded.map((j) => j.channel)).toEqual(['ntfy', 'telegram'])
  })

  it('completes as a no-op (zero enqueueDelivery calls) and warns when the resolved set is empty', async () => {
    const { logger, service, recorded } = makeService([channel('discord', 'discord')])

    await service.handleDispatch({
      notification: { title: 't', message: 'm' },
      profileId: 'phone',
      requestedChannels: ['ntfy', 'telegram']
    })

    expect(recorded).toEqual([])
    expect(logger.entries).toHaveLength(1)
    expect(logger.entries[0].level).toBe('warn')
  })

  it('fans out to multiple instances OF THE SAME TYPE when several are enabled', async () => {
    // Two slack instances for two companies -- both enabled, both must get a job.
    const { service, recorded } = makeService([
      channel('acme-slack', 'slack'),
      channel('globex-slack', 'slack')
    ])

    await service.handleDispatch({
      notification: { title: 't', message: 'm' },
      profileId: 'phone',
      requestedChannels: ['acme-slack', 'globex-slack']
    })

    expect(recorded.map((j) => j.channel)).toEqual(['acme-slack', 'globex-slack'])
    // Same origin dispatch id shared across the fan-out.
    expect(recorded[0].dispatchJobId).toEqual(recorded[1].dispatchJobId)
  })
})
