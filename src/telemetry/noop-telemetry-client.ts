/**
 * No-op TelemetryPort used for every disabled/no-key boot path (TEL-01
 * AC1/AC4): resolves immediately, makes no network call, records nothing.
 */
import type { HeartbeatProperties, TelemetryPort } from './telemetry-port.js'

export class NoopTelemetryClient implements TelemetryPort {
  async sendHeartbeat(_props: HeartbeatProperties): Promise<void> {
    // Intentionally does nothing: telemetry is disabled or unconfigured.
  }
}
