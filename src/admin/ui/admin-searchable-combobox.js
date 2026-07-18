/**
 * Generic searchable-combobox core (LTTS-05): pure filter + selection-state
 * helpers, DOM-free so they're unit-testable without a browser or any new
 * DOM-testing dependency. Not local-tts-specific -- callers decide what
 * `searchText` means (e.g. voice name + locale + sample); this file just
 * filters/navigates a `{value, label, searchText}[]` list. The DOM half
 * (input/panel rendering, keyboard/focus wiring) lives in
 * admin-searchable-combobox-dom.js to keep each file under the project's
 * ~200-line-per-file guideline (mirrors how admin-field-row.js was split
 * out of admin-channels.js for the same reason).
 */

/**
 * Case-insensitive substring filter of `options` against `query`,
 * preserving original relative order among matches (no ranking -- simple
 * filter, per spec). Empty/whitespace-only query returns every option, in
 * original order. Never mutates `options`.
 */
export function filterOptions(options, query) {
  const needle = (query ?? '').trim().toLowerCase()
  if (!needle) {
    return options.slice()
  }
  return options.filter((option) => option.searchText.toLowerCase().includes(needle))
}

/**
 * Clamped highlighted-index transition for ArrowUp (`delta: -1`) / ArrowDown
 * (`delta: 1`) within a `length`-long filtered list. Returns -1 (nothing to
 * highlight) when the list is empty; otherwise clamps to `[0, length - 1]`
 * without wrapping past either end.
 */
export function moveHighlightIndex(currentIndex, delta, length) {
  if (length <= 0) {
    return -1
  }
  const from = currentIndex < 0 ? -1 : Math.min(currentIndex, length - 1)
  return Math.max(0, Math.min(from + delta, length - 1))
}

/**
 * What Enter should select: the currently highlighted option, or -- when
 * nothing is highlighted -- the sole option when the filtered list has
 * exactly one match (typing a unique substring and hitting Enter should
 * work without arrowing down first). Returns `null` when nothing should be
 * selected.
 */
export function resolveEnterSelection(filtered, highlightIndex) {
  if (highlightIndex >= 0 && highlightIndex < filtered.length) {
    return filtered[highlightIndex]
  }
  return filtered.length === 1 ? filtered[0] : null
}
