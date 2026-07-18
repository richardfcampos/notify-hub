/**
 * Pure payload shape sent to PostHog (TEL-01 AC3). Kept as a standalone pure
 * function so the EXACT fields ever transmitted are unit-testable without
 * touching the posthog-node SDK -- the privacy commitment (spec "Out of
 * Scope": no instance ids/labels/tokens/hostnames/message content) lives
 * entirely in this one function plus the closed HeartbeatProperties type.
 * `$process_person_profile: false` tells PostHog to record a pure anonymous
 * event row, never build a Person profile tied to the distinctId.
 */
import type { HeartbeatProperties } from './telemetry-port.js'

export interface PostHogHeartbeatPayload {
  version: string
  channelTypesEnabled: string[]
  platform: string
  $process_person_profile: false
}

/** An empty `channelTypesEnabled` array is preserved as `[]`, never omitted
 * or turned into null/undefined -- proves absence rather than hiding it. */
export function buildHeartbeatProperties(props: HeartbeatProperties): PostHogHeartbeatPayload {
  return {
    version: props.version,
    channelTypesEnabled: [...props.channelTypesEnabled],
    platform: props.platform,
    $process_person_profile: false
  }
}
