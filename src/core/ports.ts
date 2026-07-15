/**
 * Ports (Hexagonal architecture): interfaces for every external seam the
 * domain depends on. Core logic and channel adapters depend on these, never
 * on concrete implementations (fetch, nodemailer, BullMQ, Date.now, ...),
 * so tests can inject fakes with zero network/Redis/SMTP.
 */
import type { Profile, DispatchJob, DeliveryJob } from './types.js'

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

/** Resolves a Bearer token to its profile, or null when unknown. */
export interface TokenResolver {
  resolve(token: string | undefined): Profile | null
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
