/**
 * Shared helper for the voice channels (`local-tts`, `voicemonkey`), spec
 * VNR-01. The hook formats `title` as `<emoji> <project> — <status>` (e.g.
 * `✅ notify-hub — concluído`) meant for visual channels; spoken aloud, the
 * full `message` body (Início/Fim/duração/headline) is tedious to listen
 * to. This strips the leading emoji/symbol run (and the whitespace after
 * it) from `title` and speaks just that -- never `message` -- when a title
 * is present.
 */
import type { Notification } from '../../core/types.js'

/**
 * Matches a leading run of characters that are neither a Unicode letter
 * (`\p{L}`) nor a Unicode digit (`\p{N}`) -- covers emoji (often
 * multi-codepoint, e.g. flags/skin-tone modifiers), other symbols, and
 * whitespace in one pass. The Unicode-aware `u` flag + property escapes are
 * required here: a naive ASCII-only class (e.g. `[^a-zA-Z0-9]`) would leave
 * emoji byte fragments behind instead of stripping the whole glyph.
 */
const LEADING_SYMBOL_RUN = /^[^\p{L}\p{N}]+/u

/**
 * Derives the brief spoken summary for a notification. Falls back to
 * `message` only when `title` itself is absent/empty (VNR-01 AC2) -- a
 * title that's ONLY symbols still returns the stripped (possibly
 * near-empty) remainder rather than silently falling back (spec Edge
 * Cases), since that's a theoretical edge, not a "no title" case.
 */
export function spokenSummary(notification: Notification): string {
  if (!notification.title) {
    return notification.message
  }
  return notification.title.replace(LEADING_SYMBOL_RUN, '').trim()
}
