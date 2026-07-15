/**
 * Tests derive from spec NOTIF-11 (token -> profile) and T14's Done-when:
 * a known token resolves to its profile; unknown/undefined/empty tokens
 * resolve to null. No fakes needed -- the resolver is pure.
 */
import { describe, expect, it } from 'vitest'
import type { Profile } from '../core/types.js'
import { createTokenResolver } from './token-resolver.js'

const phone: Profile = {
  name: 'phone',
  token: 'tok-phone',
  defaultChannels: ['ntfy', 'telegram']
}
const desktop: Profile = {
  name: 'desktop',
  token: 'tok-desktop',
  defaultChannels: ['discord']
}

describe('createTokenResolver', () => {
  it('resolves a known token to its exact profile', () => {
    const resolver = createTokenResolver([phone, desktop])
    expect(resolver.resolve('tok-phone')).toEqual(phone)
    expect(resolver.resolve('tok-desktop')).toEqual(desktop)
  })

  it('returns null for an unknown token', () => {
    const resolver = createTokenResolver([phone])
    expect(resolver.resolve('nope')).toBeNull()
  })

  it('returns null for an undefined token', () => {
    const resolver = createTokenResolver([phone])
    expect(resolver.resolve(undefined)).toBeNull()
  })

  it('returns null for an empty-string token', () => {
    const resolver = createTokenResolver([phone])
    expect(resolver.resolve('')).toBeNull()
  })

  it('returns null when no profiles are configured', () => {
    const resolver = createTokenResolver([])
    expect(resolver.resolve('tok-phone')).toBeNull()
  })
})
