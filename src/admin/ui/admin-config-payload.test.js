import { describe, expect, it } from 'vitest'
import { assembleConfigPayload } from './admin-config-payload.js'

const requiredConfigByType = {
  ntfy: ['NTFY_URL', 'NTFY_TOPIC'],
  slack: ['SLACK_WEBHOOK_URL']
}

describe('assembleConfigPayload', () => {
  it('drops config keys not required by the channel type', () => {
    const config = {
      channels: [
        {
          id: 'acme-ntfy',
          label: 'Acme Ntfy',
          type: 'ntfy',
          enabled: true,
          config: { NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't', STRAY_KEY: 'leftover' }
        }
      ],
      profiles: []
    }

    const payload = assembleConfigPayload(config, requiredConfigByType)

    expect(payload.channels[0].config).toEqual({ NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 't' })
  })

  it('fills a missing required key with an empty string rather than omitting it', () => {
    const config = {
      channels: [{ id: 'acme-slack', label: 'Acme Slack', type: 'slack', enabled: false, config: {} }],
      profiles: []
    }

    const payload = assembleConfigPayload(config, requiredConfigByType)

    expect(payload.channels[0].config).toEqual({ SLACK_WEBHOOK_URL: '' })
  })

  it('keeps a channel of an unknown type as-is instead of dropping its config', () => {
    const config = {
      channels: [{ id: 'legacy', label: 'Legacy', type: 'carrier-pigeon', enabled: false, config: { FOO: 'bar' } }],
      profiles: []
    }

    const payload = assembleConfigPayload(config, requiredConfigByType)

    expect(payload.channels[0].config).toEqual({ FOO: 'bar' })
  })

  it('copies profiles, including a fresh defaultChannels array (no aliasing)', () => {
    const config = {
      channels: [],
      profiles: [{ id: 'acme', name: 'Acme', token: 'tok', defaultChannels: ['acme-ntfy'] }]
    }

    const payload = assembleConfigPayload(config, requiredConfigByType)

    expect(payload.profiles).toEqual(config.profiles)
    expect(payload.profiles[0].defaultChannels).not.toBe(config.profiles[0].defaultChannels)
  })

  it('produces empty arrays for an empty working state', () => {
    expect(assembleConfigPayload({ channels: [], profiles: [] }, requiredConfigByType)).toEqual({
      channels: [],
      profiles: []
    })
  })
})
