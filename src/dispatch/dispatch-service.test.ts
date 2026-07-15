/**
 * Tests derive from spec NOTIF-03 (fan-out selection) and T11's Done-when:
 * requested∩active, default∩active, empty resolved set -> no-op + warn,
 * and the exact per-channel DeliveryJob shape for a multi-channel fan-out.
 * Uses InMemoryQueue (registering onDelivery to observe the exact enqueued
 * jobs) + FakeLogger -- no real queue/network involved.
 */
import { describe, expect, it } from 'vitest'
import { FakeLogger } from '../../test/helpers/fakes.js'
import type { DeliveryJob, DispatchJob, Profile } from '../core/types.js'
import { InMemoryQueue } from '../queue/in-memory-queue.js'
import { DispatchService, resolveChannels } from './dispatch-service.js'

const profile: Profile = {
  name: 'phone',
  token: 'secret',
  defaultChannels: ['ntfy', 'telegram']
}

describe('resolveChannels', () => {
  it('intersects requested with active, preserving order and deduping', () => {
    const active = new Set(['ntfy', 'telegram', 'discord'])
    const resolved = resolveChannels(
      profile,
      ['discord', 'ntfy', 'discord', 'slack'],
      active
    )
    expect(resolved).toEqual(['discord', 'ntfy'])
  })

  it('falls back to profile.defaultChannels ∩ active when requested is omitted', () => {
    const active = new Set(['ntfy', 'discord'])
    const resolved = resolveChannels(profile, undefined, active)
    expect(resolved).toEqual(['ntfy'])
  })

  it('filters out requested channels that are not active/unknown', () => {
    const active = new Set(['ntfy'])
    const resolved = resolveChannels(profile, ['bogus', 'ntfy'], active)
    expect(resolved).toEqual(['ntfy'])
  })

  it('returns an empty array when nothing in the source is active', () => {
    const active = new Set(['discord'])
    const resolved = resolveChannels(profile, ['ntfy', 'slack'], active)
    expect(resolved).toEqual([])
  })
})

describe('DispatchService.handleDispatch', () => {
  function makeService(deps: {
    activeChannels: Set<string>
    resolveProfile?: (name: string) => Profile
  }) {
    const queue = new InMemoryQueue()
    const logger = new FakeLogger()
    const service = new DispatchService({
      queue,
      logger,
      activeChannels: deps.activeChannels,
      resolveProfile: deps.resolveProfile ?? (() => profile)
    })
    return { queue, logger, service }
  }

  it('enqueues one delivery job per resolved channel with the correct channel + notification', async () => {
    const { queue, service } = makeService({
      activeChannels: new Set(['ntfy', 'telegram', 'discord'])
    })
    const recorded: DeliveryJob[] = []
    queue.onDelivery(async (job) => {
      recorded.push(job)
    })

    const job: DispatchJob = {
      notification: { title: 'Build finished', message: 'All tests passed' },
      profileName: 'phone',
      requestedChannels: ['ntfy', 'discord']
    }
    await service.handleDispatch(job)

    expect(recorded).toHaveLength(2)
    expect(recorded[0].channel).toBe('ntfy')
    expect(recorded[0].notification).toEqual(job.notification)
    expect(recorded[1].channel).toBe('discord')
    expect(recorded[1].notification).toEqual(job.notification)
    // Every delivery job spawned from the same dispatch call shares one id.
    expect(recorded[0].dispatchJobId).toEqual(recorded[1].dispatchJobId)
    expect(typeof recorded[0].dispatchJobId).toBe('string')
  })

  it('falls back to the profile defaults when the job omits requestedChannels', async () => {
    const { queue, service } = makeService({
      activeChannels: new Set(['ntfy', 'telegram'])
    })
    const recorded: DeliveryJob[] = []
    queue.onDelivery(async (job) => {
      recorded.push(job)
    })

    await service.handleDispatch({
      notification: { title: 't', message: 'm' },
      profileName: 'phone'
    })

    expect(recorded.map((j) => j.channel)).toEqual(['ntfy', 'telegram'])
  })

  it('completes as a no-op (zero enqueueDelivery calls) and logs a warning when the resolved set is empty', async () => {
    const { queue, logger, service } = makeService({
      activeChannels: new Set(['discord'])
    })
    const recorded: DeliveryJob[] = []
    queue.onDelivery(async (job) => {
      recorded.push(job)
    })

    await service.handleDispatch({
      notification: { title: 't', message: 'm' },
      profileName: 'phone',
      requestedChannels: ['ntfy', 'telegram']
    })

    expect(recorded).toEqual([])
    expect(logger.entries).toHaveLength(1)
    expect(logger.entries[0].level).toBe('warn')
  })
})
