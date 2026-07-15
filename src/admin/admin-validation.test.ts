/**
 * Tests derive from spec ADMIN-03 / P1 "See and edit channel configuration"
 * AC4 and "Tokens / profiles management" AC3: enabled-channel-missing-key
 * rejected naming channel+key, profile default channel not enabled
 * rejected naming it, happy path passes.
 */
import { describe, expect, it } from 'vitest'
import type { AdminConfig, ChannelSchema } from './admin-config.js'
import { validateAdminConfig } from './admin-validation.js'

const registry: Record<string, ChannelSchema> = {
  ntfy: { requiredConfig: ['NTFY_URL', 'NTFY_TOPIC'] },
  slack: { requiredConfig: ['SLACK_WEBHOOK_URL'] }
}

function baseConfig(): AdminConfig {
  return {
    channels: {
      ntfy: { enabled: false, values: { NTFY_URL: '', NTFY_TOPIC: '' } },
      slack: { enabled: false, values: { SLACK_WEBHOOK_URL: '' } }
    },
    profiles: [],
    extraKeys: {}
  }
}

describe('validateAdminConfig', () => {
  it('rejects naming the channel and missing key when an enabled channel lacks a required value', () => {
    const cfg = baseConfig()
    cfg.channels.slack = { enabled: true, values: { SLACK_WEBHOOK_URL: '' } }

    const result = validateAdminConfig(cfg, registry)

    expect(result).toEqual({
      ok: false,
      error: 'Channel "slack" is enabled but missing required config "SLACK_WEBHOOK_URL"'
    })
  })

  it('rejects a whitespace-only value as missing', () => {
    const cfg = baseConfig()
    cfg.channels.slack = { enabled: true, values: { SLACK_WEBHOOK_URL: '   ' } }

    const result = validateAdminConfig(cfg, registry)

    expect(result.ok).toBe(false)
  })

  it('rejects naming a profile default channel that is not enabled', () => {
    const cfg = baseConfig()
    cfg.channels.ntfy = { enabled: true, values: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' } }
    cfg.profiles = [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy', 'slack'] }]

    const result = validateAdminConfig(cfg, registry)

    expect(result).toEqual({
      ok: false,
      error: 'Profile "phone" has default channel "slack" which is not enabled'
    })
  })

  it('passes when all enabled channels are fully configured and all default channels are enabled', () => {
    const cfg = baseConfig()
    cfg.channels.ntfy = { enabled: true, values: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' } }
    cfg.profiles = [{ name: 'phone', token: 'tok', defaultChannels: ['ntfy'] }]

    expect(validateAdminConfig(cfg, registry)).toEqual({ ok: true })
  })

  it('passes when no channels are enabled and no profiles exist (happy empty path)', () => {
    expect(validateAdminConfig(baseConfig(), registry)).toEqual({ ok: true })
  })
})
