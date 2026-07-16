/**
 * Central mutable state for the admin dashboard (ADMIN-07: "track unsaved
 * changes"): the in-memory working config being edited -- `{channels:
 * ChannelInstance[], profiles: ProfileRecord[]}` (DBCH-08/09) -- plus the
 * dirty flag driving the sticky save bar. Render modules mutate the config
 * object returned by getConfig() directly (see
 * admin-channels.js/admin-profiles.js) and call markEdited() -- no
 * framework, just a tiny pub/sub so the save bar reacts without polling.
 */

let config = null
let savedSnapshot = null
let dirty = false

const listeners = new Set()

function notify() {
  for (const fn of listeners) {
    fn()
  }
}

/** Subscribes `fn` to every state change; returns an unsubscribe function. */
export function onStateChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getConfig() {
  return config
}

export function isDirty() {
  return dirty
}

/** Replaces the working config from a fresh GET /api/config -- clears dirty since the in-memory state now matches the server exactly. */
export function setConfigFromServer(cfg) {
  config = cfg
  savedSnapshot = structuredClone(cfg)
  dirty = false
  notify()
}

/** Flags that the caller already mutated `config` in place; flips dirty and shows the sticky save bar. */
export function markEdited() {
  dirty = true
  notify()
}

/** Reverts to the last known-good server snapshot, discarding local edits (the sticky bar's "Discard" action). */
export function discardEdits() {
  config = structuredClone(savedSnapshot)
  dirty = false
  notify()
}

/** After a successful Save & Apply, the just-saved config becomes the new snapshot. */
export function markSaved() {
  savedSnapshot = structuredClone(config)
  dirty = false
  notify()
}
