/**
 * Composition point for the telemetry seam (TEL-01 AC1/AC4): returns a
 * NoopTelemetryClient for every disabled path (opt-out gate off, or
 * POSTHOG_API_KEY unset/empty) so no PostHog client is EVER constructed nor
 * any network call attempted unless the user explicitly opted in AND a key
 * is present. `POSTHOG_API_KEY` has no baked-in default here: Richard
 * supplies the maintainer's real write-only key out of band once the
 * PostHog project exists (spec "API key distribution" -- a future step);
 * until then, an absent key means telemetry stays a no-op even if opted in.
 */
import { isTelemetryEnabled } from './resolve-telemetry-enabled.js'
import { NoopTelemetryClient } from './noop-telemetry-client.js'
import { PostHogTelemetryClient } from './posthog-telemetry-client.js'
import type { TelemetryPort } from './telemetry-port.js'

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>

export interface BuildTelemetryClientOptions {
  env: EnvLike
  distinctId: string
}

export function buildTelemetryClient(options: BuildTelemetryClientOptions): TelemetryPort {
  const apiKey = options.env.POSTHOG_API_KEY
  if (!isTelemetryEnabled(options.env) || !apiKey) {
    return new NoopTelemetryClient()
  }
  return new PostHogTelemetryClient({ apiKey, distinctId: options.distinctId })
}
