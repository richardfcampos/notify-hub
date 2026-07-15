/**
 * Central channel registry (the pluggability seam): the single `name ->
 * ChannelRegistryEntry` map assembled from every adapter's exported entry.
 * Adding a channel is one import + one line here. `requiredConfigByChannel`
 * is derived from the same map so config loading and channel building agree
 * on which env keys each channel needs (spec NOTIF-10) without duplication.
 */
import type { ChannelRegistryEntry } from '../core/types.js'
import { discordRegistryEntry } from './adapters/discord-channel.js'
import { emailRegistryEntry } from './adapters/email-channel.js'
import { ntfyRegistryEntry } from './adapters/ntfy-channel.js'
import { slackRegistryEntry } from './adapters/slack-channel.js'
import { telegramRegistryEntry } from './adapters/telegram-channel.js'
import { whatsappRegistryEntry } from './adapters/whatsapp-channel.js'

export const channelRegistry: Record<string, ChannelRegistryEntry> = {
  ntfy: ntfyRegistryEntry,
  telegram: telegramRegistryEntry,
  email: emailRegistryEntry,
  slack: slackRegistryEntry,
  discord: discordRegistryEntry,
  whatsapp: whatsappRegistryEntry
}

/** channel name -> required env keys, derived from the registry above. */
export const requiredConfigByChannel: Record<string, string[]> = Object.fromEntries(
  Object.entries(channelRegistry).map(([name, entry]) => [name, entry.requiredConfig])
)
