/**
 * Token -> Profile resolver (spec NOTIF-11). Builds an O(1) lookup from the
 * configured profiles so the API auth preHandler can turn a Bearer token
 * into its profile (or null when the token is unknown/absent). Pure and
 * dependency-free; the API layer decides the 401 policy on a null result.
 */
import type { TokenResolver } from '../core/ports.js'
import type { Profile } from '../core/types.js'

export function createTokenResolver(profiles: Profile[]): TokenResolver {
  const byToken = new Map<string, Profile>()
  for (const profile of profiles) {
    byToken.set(profile.token, profile)
  }

  return {
    resolve(token: string | undefined): Profile | null {
      if (!token) {
        return null
      }
      return byToken.get(token) ?? null
    }
  }
}
