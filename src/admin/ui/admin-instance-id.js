/**
 * Pure helpers for channel instance ids (DBCH-09, tasks.md D10). The id is
 * a slug: immutable once the instance is created, used as the SQLite PK and
 * in profile default-channel refs, so the Add-channel form validates it
 * live against the SAME rule the backend enforces
 * (src/admin/config-validation.ts `CHANNEL_ID_SLUG_RE`) instead of letting a
 * bad id round-trip to a 400 after the fact. No DOM -- unit-tested directly.
 */

export const CHANNEL_ID_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** `Acme Slack!` -> `acme-slack` -- lowercases, collapses any run of non `[a-z0-9]` characters into a single hyphen, and trims leading/trailing hyphens. Suggests an id from a free-typed label; the operator can still edit it by hand. */
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Same rule the backend's write-time validation enforces. */
export function isValidChannelId(id) {
  return CHANNEL_ID_SLUG_RE.test(id)
}
