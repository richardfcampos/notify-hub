/**
 * Domain value objects and contracts for the notification gateway.
 * These are pure data shapes + the Strategy interface every channel
 * implements. External seams (HTTP, mail, queue, clock, logger) live in
 * ./ports.ts; imported here only as types so this stays dependency-free
 * at runtime.
 */
import type { HttpClient, MailTransport, Logger } from './ports.js'

/** Delivery priority hint passed through to channels that support it. */
export type Priority = 'low' | 'default' | 'high' | 'urgent'

/** A single notification to be delivered to one or more channels. */
export interface Notification {
  title: string
  message: string
  priority?: Priority
  tags?: string[]
  /** Free-form context (event, project, durationMs, timestamp, sessionId, ...). */
  metadata?: Record<string, unknown>
}

/** Outcome of attempting delivery on one channel. */
export interface DeliveryResult {
  channel: string
  ok: boolean
  error?: string
  attempts: number
  durationMs: number
}

/** A token holder and the channels they receive by default. */
export interface Profile {
  name: string
  token: string
  defaultChannels: string[]
}

/**
 * A named channel instance persisted in the DB: N per type (e.g. two Slack
 * instances for two companies), each with its own id, display label, and
 * credentials. `config` holds the type's required keys (see the registry).
 */
export interface ChannelInstance {
  id: string
  label: string
  type: string
  enabled: boolean
  config: Record<string, string>
}

/** A token profile persisted in the DB and the instance ids it routes to by default. */
export interface ProfileRecord {
  id: string
  name: string
  token: string
  defaultChannels: string[]
}

/**
 * Strategy interface: every channel (ntfy, Telegram, Email, Slack, Discord,
 * WhatsApp, ...) implements exactly this. Throw = failure; the queue/worker
 * layer converts that into retry + a DeliveryResult.
 */
export interface NotificationChannel {
  readonly name: string
  send(notification: Notification): Promise<void>
}

/** Dependencies injected into every channel factory (the mockable seams). */
export interface ChannelDeps {
  http: HttpClient
  mail: MailTransport
  logger: Logger
}

/** Builds a channel instance from its resolved config + injected deps. */
export type ChannelFactory = (
  cfg: Record<string, string>,
  deps: ChannelDeps
) => NotificationChannel

/** One entry in the name -> factory registry (the pluggability seam). */
export interface ChannelRegistryEntry {
  factory: ChannelFactory
  /** Env keys that MUST be present for this channel when it is enabled. */
  requiredConfig: string[]
  /** Max message length before TruncatingChannel truncates. Unset = no limit. */
  maxLength?: number
}

/** Fully validated application configuration (see config/load-config.ts). */
export interface AppConfig {
  port: number
  redisUrl: string
  /** Parsed from TOKENS env var. */
  profiles: Profile[]
  /** Parsed from CHANNELS_ENABLED env var. */
  channelsEnabled: string[]
  /** Per-channel credentials, keyed by channel name. */
  channelConfig: Record<string, Record<string, string>>
  retry: {
    attempts: number
    backoffMs: number
  }
}

/**
 * Job enqueued by the API; the dispatch worker fans this out per instance.
 * `profileId` is the ProfileRecord id and is authoritative: when
 * `requestedChannels` is absent the dispatcher resolves the profile's
 * default instance ids from the DB at dispatch time (so profile edits also
 * hot-reload). `profileName` is carried for logs/tracing only. Adding fields
 * keeps the queue payload backward-compatible (versionable).
 */
export interface DispatchJob {
  notification: Notification
  profileId: string
  profileName?: string
  requestedChannels?: string[]
  dedupKey?: string
}

/**
 * One per-instance job produced by the dispatch worker. `channel` is the
 * named channel INSTANCE id (e.g. `acme-slack`), resolved to its config at
 * delivery time by the delivery service.
 */
export interface DeliveryJob {
  notification: Notification
  channel: string
  dispatchJobId: string
}
