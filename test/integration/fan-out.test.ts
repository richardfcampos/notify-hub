/**
 * Fan-out + partial-failure isolation integration test (spec NOTIF-03,
 * NOTIF-04). Wires a real container over an InMemoryQueue with three fake
 * channels -- one always throws, two succeed -- registers the workers, and
 * drives one dispatch. Asserts the actual per-channel outcomes: every
 * channel was attempted (fan-out) and the one failure did NOT stop the
 * other two from delivering successfully (isolation), recorded in
 * queue.deliveries.
 */
import { describe, expect, it } from 'vitest'
import { buildContainer } from '../../src/container.js'
import type { AppConfig, Notification, NotificationChannel } from '../../src/core/types.js'
import { InMemoryQueue } from '../../src/queue/in-memory-queue.js'
import { FakeLogger } from '../helpers/fakes.js'

class FakeChannel implements NotificationChannel {
  readonly received: Notification[] = []

  constructor(
    readonly name: string,
    private readonly failWith?: Error
  ) {}

  async send(notification: Notification): Promise<void> {
    this.received.push(notification)
    if (this.failWith) {
      throw this.failWith
    }
  }
}

const config: AppConfig = {
  port: 3000,
  redisUrl: 'redis://unused',
  profiles: [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy', 'telegram', 'slack'] }],
  channelsEnabled: [],
  channelConfig: {},
  retry: { attempts: 3, backoffMs: 100 }
}

describe('fan-out with partial-failure isolation', () => {
  it('attempts every resolved channel; a failing one does not stop the others', async () => {
    const ntfy = new FakeChannel('ntfy', new Error('ntfy is down'))
    const telegram = new FakeChannel('telegram')
    const slack = new FakeChannel('slack')

    const queue = new InMemoryQueue()
    const container = buildContainer(config, {
      queue,
      logger: new FakeLogger(),
      channels: new Map<string, NotificationChannel>([
        ['ntfy', ntfy],
        ['telegram', telegram],
        ['slack', slack]
      ])
    })
    container.registerWorkers()

    const notification: Notification = { title: 'Build', message: 'done' }
    await container.queue.enqueueDispatch({
      notification,
      profileName: 'phone'
      // no requestedChannels -> falls back to the profile's three defaults
    })

    // Fan-out: all three channels were actually attempted.
    expect(ntfy.received).toHaveLength(1)
    expect(telegram.received).toHaveLength(1)
    expect(slack.received).toHaveLength(1)

    // Isolation: three per-channel results, the two good ones ok, the bad one not.
    expect(queue.deliveries).toHaveLength(3)
    const byChannel = new Map(queue.deliveries.map((d) => [d.channel, d]))
    expect(byChannel.get('ntfy')?.ok).toBe(false)
    expect(byChannel.get('ntfy')?.error).toContain('ntfy is down')
    expect(byChannel.get('telegram')?.ok).toBe(true)
    expect(byChannel.get('slack')?.ok).toBe(true)
  })

  it('delivers to exactly the requested subset when channels are specified', async () => {
    const ntfy = new FakeChannel('ntfy')
    const telegram = new FakeChannel('telegram')

    const queue = new InMemoryQueue()
    const container = buildContainer(config, {
      queue,
      logger: new FakeLogger(),
      channels: new Map<string, NotificationChannel>([
        ['ntfy', ntfy],
        ['telegram', telegram]
      ])
    })
    container.registerWorkers()

    await container.queue.enqueueDispatch({
      notification: { title: 't', message: 'm' },
      profileName: 'phone',
      requestedChannels: ['telegram']
    })

    expect(ntfy.received).toHaveLength(0)
    expect(telegram.received).toHaveLength(1)
    expect(queue.deliveries).toEqual([{ channel: 'telegram', ok: true }])
  })
})
