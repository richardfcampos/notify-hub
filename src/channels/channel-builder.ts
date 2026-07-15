/**
 * Builds active NotificationChannel instances from a name -> registry-entry
 * map, wrapping each with the cross-cutting decorators (truncate, log).
 * The composition root (Phase 4) supplies the assembled registry across
 * all adapters; this module only depends on the ChannelRegistryEntry
 * contract, so it stays testable without importing any real adapter.
 */
import type {
  ChannelDeps,
  ChannelRegistryEntry,
  NotificationChannel
} from '../core/types.js'
import { LoggingChannel } from './decorators/logging-channel.js'
import { TruncatingChannel } from './decorators/truncating-channel.js'

export class ChannelBuilder {
  /**
   * Builds one wrapped channel per name in `enabled`. Throws when:
   * - a name in `enabled` has no entry in `registry` (unknown channel)
   * - a key in `registry[name].requiredConfig` is missing/empty in
   *   `channelConfig[name]` (fail-fast credential check, spec NOTIF-10)
   */
  static buildActive(
    registry: Record<string, ChannelRegistryEntry>,
    enabled: string[],
    channelConfig: Record<string, Record<string, string>>,
    deps: ChannelDeps
  ): Map<string, NotificationChannel> {
    const channels = new Map<string, NotificationChannel>()

    for (const name of enabled) {
      const entry = registry[name]
      if (!entry) {
        throw new Error(`Unknown channel "${name}" is not registered`)
      }

      const cfg = channelConfig[name] ?? {}
      for (const key of entry.requiredConfig) {
        if (!cfg[key] || cfg[key].trim() === '') {
          throw new Error(
            `Channel "${name}" is enabled but missing required config "${key}"`
          )
        }
      }

      const inner = entry.factory(cfg, deps)
      const truncating = new TruncatingChannel(inner, entry.maxLength ?? Infinity)
      const logging = new LoggingChannel(truncating, deps.logger)
      channels.set(name, logging)
    }

    return channels
  }
}
