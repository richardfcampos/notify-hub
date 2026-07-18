/**
 * Port for the anonymous product-adoption heartbeat (TEL-01). Implemented by
 * the real PostHog-backed client and a no-op used for every disabled/no-key
 * path; container boot depends only on this interface so tests inject a
 * FakeTelemetryClient with zero network calls (Ports & Adapters, matching
 * ChannelRepository/MailTransport/HttpClient in core/ports.ts).
 */

/** The exact, closed set of fields ever sent -- see spec "Out of Scope": no
 * instance ids/labels, no profile data, no tokens, no message content, no
 * hostname/IP. */
export interface HeartbeatProperties {
  version: string
  channelTypesEnabled: string[]
  platform: string
}

export interface TelemetryPort {
  sendHeartbeat(props: HeartbeatProperties): Promise<void>
}
