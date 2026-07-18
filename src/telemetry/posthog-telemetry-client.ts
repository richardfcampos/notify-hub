/**
 * Real PostHog-backed TelemetryPort (TEL-01 AC3/AC5, EU ingestion host per
 * spec's privacy-conscious region default). Lazily constructs a posthog-node
 * client per heartbeat -- this process sends at most one heartbeat per boot,
 * so there is no benefit to holding a long-lived client open -- and awaits
 * `shutdown()` so the buffered event is actually flushed before this
 * short-lived call returns (posthog-node batches events; a CLI-style process
 * can otherwise exit before they're sent). The entire method body is
 * wrapped in try/catch: any failure (network, malformed response, SDK
 * throw) is logged and swallowed, NEVER re-thrown, so a PostHog outage can
 * never delay or crash api/worker boot.
 */
import { PostHog } from 'posthog-node'
import { buildHeartbeatProperties } from './heartbeat-properties.js'
import type { HeartbeatProperties, TelemetryPort } from './telemetry-port.js'

const POSTHOG_HOST = 'https://eu.i.posthog.com'
const HEARTBEAT_EVENT = 'notify_hub_heartbeat'

export interface PostHogTelemetryClientOptions {
  apiKey: string
  distinctId: string
}

export class PostHogTelemetryClient implements TelemetryPort {
  constructor(private readonly options: PostHogTelemetryClientOptions) {}

  async sendHeartbeat(props: HeartbeatProperties): Promise<void> {
    try {
      const client = new PostHog(this.options.apiKey, { host: POSTHOG_HOST })
      client.capture({
        distinctId: this.options.distinctId,
        event: HEARTBEAT_EVENT,
        properties: buildHeartbeatProperties(props)
      })
      await client.shutdown()
    } catch (error) {
      console.error('telemetry: failed to send heartbeat', error)
    }
  }
}
