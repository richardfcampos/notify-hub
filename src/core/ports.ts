/**
 * Ports (Hexagonal architecture): interfaces for every external seam the
 * domain depends on. Core logic and channel adapters depend on these, never
 * on concrete implementations (fetch, nodemailer, BullMQ, Date.now, ...),
 * so tests can inject fakes with zero network/Redis/SMTP.
 */
import type {
  DispatchJob,
  DeliveryJob,
  ChannelInstance,
  ProfileRecord
} from './types.js'

/** Minimal HTTP client seam used by webhook-style channel adapters. */
export interface HttpClient {
  request(opts: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: unknown
  }): Promise<{ status: number; body: string }>
}

/** Outbound mail seam used by the Email channel adapter. */
export interface MailTransport {
  send(msg: { to: string; subject: string; text: string }): Promise<void>
}

/** Durable job queue seam; implemented by BullMQ (prod) and an in-memory
 * synchronous adapter (tests). */
export interface QueuePort {
  enqueueDispatch(job: DispatchJob): Promise<{ jobId: string }>
  enqueueDelivery(job: DeliveryJob): Promise<{ jobId: string }>
  onDispatch(handler: (job: DispatchJob) => Promise<void>): void
  onDelivery(handler: (job: DeliveryJob) => Promise<void>): void
  health(): Promise<boolean>
  close(): Promise<void>
}

/**
 * Persistence seam for named channel instances (SQLite in prod, in-memory
 * fake in tests). Read at request/delivery time so panel edits hot-reload
 * without a restart.
 */
export interface ChannelRepository {
  list(): ChannelInstance[]
  listEnabled(): ChannelInstance[]
  get(id: string): ChannelInstance | null
  upsert(channel: ChannelInstance): void
  delete(id: string): void
}

/** Persistence seam for token profiles and the channel instances they route to. */
export interface ProfileRepository {
  list(): ProfileRecord[]
  get(id: string): ProfileRecord | null
  resolveByToken(token: string | undefined): ProfileRecord | null
  upsert(profile: ProfileRecord): void
  delete(id: string): void
  setDefaultChannels(profileId: string, channelIds: string[]): void
}

/** Injectable time source so services stay deterministic in tests. */
export interface Clock {
  now(): number
}

/** Structured logger seam (pino in prod, fake recorder in tests). */
export interface Logger {
  info(o: unknown, m?: string): void
  warn(o: unknown, m?: string): void
  error(o: unknown, m?: string): void
}
