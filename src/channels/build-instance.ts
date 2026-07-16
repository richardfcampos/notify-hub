/**
 * Per-instance channel builder (DBCH-04). Given a named channel instance
 * (its type + its own config, read from the DB at delivery time) and the
 * mockable deps, look up the TYPE in the registry, build the adapter from
 * the instance's config, and wrap it with the same cross-cutting decorators
 * as a static build (truncate to the type's maxLength, then log). The log
 * label is the INSTANCE id (not the type) so a fan-out across two same-type
 * instances stays distinguishable in the logs.
 *
 * The registry defaults to the assembled production registry but is
 * injectable so this stays unit-testable with a stub registry/adapter.
 */
import { channelRegistry } from './channel-registry.js'
import { LoggingChannel } from './decorators/logging-channel.js'
import { TruncatingChannel } from './decorators/truncating-channel.js'
import type {
  ChannelDeps,
  ChannelInstance,
  ChannelRegistryEntry,
  NotificationChannel
} from '../core/types.js'

/**
 * Builds one wrapped NotificationChannel for `instance`. Throws when the
 * instance's `type` has no registry entry (the message names both the
 * unknown type and the offending instance id so the failure is diagnosable
 * from the message alone). Unlike the legacy static builder this does NOT
 * fail-fast on missing config: config is dynamic now, so a misconfigured
 * instance errors gracefully at send time (isolated per delivery).
 */
export function buildInstance(
  instance: ChannelInstance,
  deps: ChannelDeps,
  registry: Record<string, ChannelRegistryEntry> = channelRegistry
): NotificationChannel {
  const entry = registry[instance.type]
  if (!entry) {
    throw new Error(
      `Unknown channel type "${instance.type}" for instance "${instance.id}"`
    )
  }

  const inner = entry.factory(instance.config, deps)
  const truncating = new TruncatingChannel(inner, entry.maxLength ?? Infinity)
  return new LoggingChannel(truncating, deps.logger, instance.id)
}
