/**
 * End-to-end route tests via Fastify `app.inject` (no listener, no Redis).
 * Derived from spec NOTIF-01 (202/400/401/503), NOTIF-14 (health 200 +
 * redis indicator) and the edge cases (empty message -> 400, unknown
 * channel -> 400). Assertions are on response status + body values, plus
 * the actual DispatchJob captured from the InMemoryQueue -- not on whether
 * a handler merely ran.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTokenResolver } from '../auth/token-resolver.js'
import type { DispatchJob } from '../core/types.js'
import type { QueuePort } from '../core/ports.js'
import { FakeLogger } from '../../test/helpers/fakes.js'
import { InMemoryQueue } from '../queue/in-memory-queue.js'
import { buildServer, type ServerDeps } from './server.js'

const TOKEN = 'tok-phone'
const profile = {
  name: 'phone',
  token: TOKEN,
  defaultChannels: ['ntfy', 'telegram']
}

function makeApp(overrides: Partial<ServerDeps> = {}): {
  app: FastifyInstance
  queue: InMemoryQueue
  dispatched: DispatchJob[]
} {
  const queue = new InMemoryQueue()
  const dispatched: DispatchJob[] = []
  queue.onDispatch(async (job) => {
    dispatched.push(job)
  })
  const deps: ServerDeps = {
    queue,
    tokenResolver: createTokenResolver([profile]),
    activeChannelNames: ['ntfy', 'telegram'],
    logger: new FakeLogger(),
    ...overrides
  }
  return { app: buildServer(deps), queue, dispatched }
}

let current: FastifyInstance | null = null

afterEach(async () => {
  if (current) {
    await current.close()
    current = null
  }
})

describe('POST /notify', () => {
  it('returns 202 + jobId and enqueues a DispatchJob with the right notification + profile', async () => {
    const { app, dispatched } = makeApp()
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { title: 'Build', message: 'passed', channels: ['ntfy'] }
    })

    expect(res.statusCode).toBe(202)
    const body = res.json()
    expect(typeof body.jobId).toBe('string')
    expect(body.jobId.length).toBeGreaterThan(0)

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].profileName).toBe('phone')
    expect(dispatched[0].notification.title).toBe('Build')
    expect(dispatched[0].notification.message).toBe('passed')
    expect(dispatched[0].requestedChannels).toEqual(['ntfy'])
  })

  it('defaults the title when omitted', async () => {
    const { app, dispatched } = makeApp()
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { message: 'no title here' }
    })

    expect(res.statusCode).toBe(202)
    expect(dispatched[0].notification.title).toBe('Notification')
  })

  it('returns 401 and enqueues nothing when the Authorization header is missing', async () => {
    const { app, dispatched } = makeApp()
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      payload: { message: 'hi' }
    })

    expect(res.statusCode).toBe(401)
    expect(dispatched).toHaveLength(0)
  })

  it('returns 401 for an unknown Bearer token', async () => {
    const { app, dispatched } = makeApp()
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { message: 'hi' }
    })

    expect(res.statusCode).toBe(401)
    expect(dispatched).toHaveLength(0)
  })

  it('returns 400 when message is missing', async () => {
    const { app, dispatched } = makeApp()
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { title: 'x' }
    })

    expect(res.statusCode).toBe(400)
    expect(dispatched).toHaveLength(0)
  })

  it('returns 400 when channels contains an unknown channel', async () => {
    const { app, dispatched } = makeApp()
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { message: 'hi', channels: ['bogus'] }
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('bogus')
    expect(dispatched).toHaveLength(0)
  })

  it('returns 503 when enqueueDispatch throws (queue/Redis down)', async () => {
    const throwingQueue: QueuePort = {
      enqueueDispatch: async () => {
        throw new Error('redis unreachable')
      },
      enqueueDelivery: async () => ({ jobId: 'unused' }),
      onDispatch: () => {},
      onDelivery: () => {},
      health: async () => false,
      close: async () => {}
    }
    const { app } = makeApp({ queue: throwingQueue })
    current = app

    const res = await app.inject({
      method: 'POST',
      url: '/notify',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { message: 'hi' }
    })

    expect(res.statusCode).toBe(503)
  })
})

describe('GET /health', () => {
  it('returns 200 with status ok and redis:true when the queue is healthy', async () => {
    const { app } = makeApp()
    current = app

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', redis: true })
  })

  it('reports redis:false when the queue health check fails', async () => {
    const unhealthyQueue: QueuePort = {
      enqueueDispatch: async () => ({ jobId: 'x' }),
      enqueueDelivery: async () => ({ jobId: 'x' }),
      onDispatch: () => {},
      onDelivery: () => {},
      health: async () => false,
      close: async () => {}
    }
    const { app } = makeApp({ queue: unhealthyQueue })
    current = app

    const res = await app.inject({ method: 'GET', url: '/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', redis: false })
  })
})
