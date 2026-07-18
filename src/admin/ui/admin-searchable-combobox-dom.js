/**
 * DOM half of the searchable combobox (LTTS-05): a text input + an
 * absolutely-positioned dropdown panel of filtered options, wired for
 * focus/input/keyboard-nav/click-outside. Generic/reusable -- admin-local-
 * tts.js feeds it voice options, but nothing here is local-tts-specific.
 * Composes the pure filter/highlight helpers from admin-searchable-
 * combobox.js (see that file for why the split, and for the unit tests --
 * this DOM-wiring half is exercised live/via code review, not unit-tested,
 * matching how renderLocalTtsVoiceField's own DOM rendering is handled).
 */
import { el, clear } from './admin-dom.js'
import { filterOptions, moveHighlightIndex, resolveEnterSelection } from './admin-searchable-combobox.js'

/**
 * Renders a searchable combobox into `container` (appended once; the
 * caller owns clearing `container` before any re-render). `options` is
 * `[{value, label, searchText}]`. `initialValue` pre-fills the input with
 * the matching option's label, or the raw value verbatim when it doesn't
 * match any known option -- an existing config value is never silently
 * blanked. `onSelect(value)` fires on every selection (click, Enter).
 * `inputId` (optional) sets the input's `id` so an external `<label for>`
 * can target it.
 */
export function createSearchableCombobox({ container, options, initialValue, onSelect, inputId }) {
  const initialMatch = options.find((option) => option.value === initialValue)
  let currentValue = initialValue
  let currentLabel = initialMatch ? initialMatch.label : initialValue ?? ''
  let filtered = options
  let highlightIndex = -1
  let open = false
  let docClickHandler = null

  const input = el('input', {
    type: 'text',
    id: inputId,
    class: 'combobox-input',
    autocomplete: 'off',
    spellcheck: 'false',
    value: currentLabel
  })
  const panel = el('ul', { class: 'combobox-panel', role: 'listbox' })
  panel.hidden = true

  function renderPanel() {
    clear(panel)
    filtered.forEach((option, index) => {
      panel.appendChild(
        el(
          'li',
          {
            class: `combobox-option${index === highlightIndex ? ' highlighted' : ''}`,
            role: 'option',
            'aria-selected': String(option.value === currentValue),
            // mousedown (not click) fires before the input would blur;
            // preventDefault keeps focus on the input so a click-selection
            // never races the close-on-blur/outside-click logic below.
            onmousedown: (e) => {
              e.preventDefault()
              select(option)
            }
          },
          option.label
        )
      )
    })
    if (filtered.length === 0) {
      panel.appendChild(el('li', { class: 'combobox-empty' }, 'No matches'))
    }
  }

  function openPanel() {
    if (open) return
    open = true
    panel.hidden = false
    docClickHandler = (e) => {
      if (!container.contains(e.target)) {
        closePanel({ resetLabel: true })
      }
    }
    // Added on open / removed on close (not once at module scope) so an
    // arbitrary number of combobox instances never leak listeners onto the
    // shared document object.
    document.addEventListener('click', docClickHandler)
  }

  function closePanel({ resetLabel = false } = {}) {
    if (!open) return
    open = false
    panel.hidden = true
    highlightIndex = -1
    document.removeEventListener('click', docClickHandler)
    docClickHandler = null
    if (resetLabel) {
      input.value = currentLabel
    }
  }

  function select(option) {
    currentValue = option.value
    currentLabel = option.label
    input.value = option.label
    closePanel()
    onSelect(option.value)
  }

  function showAllOptions() {
    filtered = options.slice()
    highlightIndex = filtered.findIndex((option) => option.value === currentValue)
    renderPanel()
    openPanel()
  }

  input.addEventListener('focus', () => {
    showAllOptions()
    input.select()
  })

  input.addEventListener('input', () => {
    filtered = filterOptions(options, input.value)
    highlightIndex = filtered.length > 0 ? 0 : -1
    renderPanel()
    if (!open) {
      openPanel()
    }
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlightIndex = moveHighlightIndex(highlightIndex, 1, filtered.length)
      renderPanel()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlightIndex = moveHighlightIndex(highlightIndex, -1, filtered.length)
      renderPanel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = resolveEnterSelection(filtered, highlightIndex)
      if (chosen) {
        select(chosen)
      }
    } else if (e.key === 'Escape') {
      closePanel({ resetLabel: true })
    }
  })

  container.appendChild(el('div', { class: 'combobox' }, [input, panel]))

  return { element: container }
}
