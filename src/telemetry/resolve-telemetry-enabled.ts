/**
 * Pure opt-in gate (TEL-01 AC1/AC2). Telemetry is enabled only when
 * `TELEMETRY_ENABLED` looks truthy ('true' or '1', case-insensitive -- the
 * two conventional truthy spellings for a string-typed env flag) AND
 * `DO_NOT_TRACK` is entirely unset. `DO_NOT_TRACK` is the informal
 * cross-tool convention (Homebrew, Next.js, ...): ANY non-empty value
 * disables telemetry regardless of `TELEMETRY_ENABLED`, so it is checked
 * first and short-circuits the rest of the gate.
 */
type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>

const TRUTHY_VALUES = new Set(['true', '1'])

function isTruthyString(value: string | undefined): boolean {
  return value !== undefined && TRUTHY_VALUES.has(value.trim().toLowerCase())
}

function isDoNotTrackSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

export function isTelemetryEnabled(env: EnvLike): boolean {
  if (isDoNotTrackSet(env.DO_NOT_TRACK)) {
    return false
  }
  return isTruthyString(env.TELEMETRY_ENABLED)
}
