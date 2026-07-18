/**
 * Pure filter/selection-state tests (spec LTTS-05) for the searchable
 * combobox core. No DOM needed here -- mirrors admin-defaults.test.js's
 * pure-helper style; the DOM-wiring half (admin-searchable-combobox-dom.js:
 * focus/input/keyboard/click-outside event handling, panel rendering) has
 * no automated coverage in this repo (no jsdom/happy-dom/DOM-testing-library
 * dependency is installed, and the project's existing convention -- see
 * admin-local-tts.js's own DOM half -- is to keep such rendering code
 * reviewed and exercised live rather than adding new test tooling for it).
 * That DOM half was verified by code review and a live Docker check
 * (static file served, no console/module errors) instead.
 */
import { describe, expect, it } from 'vitest'
import { filterOptions, moveHighlightIndex, resolveEnterSelection } from './admin-searchable-combobox.js'

const VOICES = [
  { value: 'Luciana', label: 'Luciana (pt_BR)', searchText: 'Luciana pt_BR Ola, como vai?' },
  {
    value: 'Grandma (Portuguese (Brazil))',
    label: 'Grandma (Portuguese (Brazil)) (pt_BR)',
    searchText: 'Grandma (Portuguese (Brazil)) pt_BR Ola'
  },
  { value: 'Samantha', label: 'Samantha (en_US)', searchText: 'Samantha en_US Hello there' }
]

describe('filterOptions', () => {
  it('returns every option, in original order, for an empty query', () => {
    expect(filterOptions(VOICES, '')).toEqual(VOICES)
  })

  it('returns every option for a whitespace-only query', () => {
    expect(filterOptions(VOICES, '   ')).toEqual(VOICES)
  })

  it('matches a substring of the name (case-insensitive)', () => {
    const result = filterOptions(VOICES, 'lucIANA')
    expect(result).toEqual([VOICES[0]])
  })

  it('matches a substring of the locale', () => {
    const result = filterOptions(VOICES, 'en_us')
    expect(result).toEqual([VOICES[2]])
  })

  it('matches a substring of the sample text', () => {
    const result = filterOptions(VOICES, 'hello there')
    expect(result).toEqual([VOICES[2]])
  })

  it('preserves original relative order among multiple matches', () => {
    const result = filterOptions(VOICES, 'pt_br')
    expect(result).toEqual([VOICES[0], VOICES[1]])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterOptions(VOICES, 'nonexistent-voice-xyz')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const copy = VOICES.slice()
    filterOptions(VOICES, 'luciana')
    expect(VOICES).toEqual(copy)
  })
})

describe('moveHighlightIndex', () => {
  it('returns -1 for an empty list regardless of direction', () => {
    expect(moveHighlightIndex(-1, 1, 0)).toBe(-1)
    expect(moveHighlightIndex(0, -1, 0)).toBe(-1)
  })

  it('moves from -1 (nothing highlighted) to 0 on ArrowDown', () => {
    expect(moveHighlightIndex(-1, 1, 3)).toBe(0)
  })

  it('advances one step on ArrowDown', () => {
    expect(moveHighlightIndex(0, 1, 3)).toBe(1)
  })

  it('clamps at the last index instead of wrapping on ArrowDown', () => {
    expect(moveHighlightIndex(2, 1, 3)).toBe(2)
  })

  it('retreats one step on ArrowUp', () => {
    expect(moveHighlightIndex(2, -1, 3)).toBe(1)
  })

  it('clamps at 0 instead of wrapping/going negative on ArrowUp', () => {
    expect(moveHighlightIndex(0, -1, 3)).toBe(0)
  })

  it('clamps into the new (shorter) list bounds if the list shrank since the last highlight', () => {
    expect(moveHighlightIndex(5, 1, 2)).toBe(1)
  })
})

describe('resolveEnterSelection', () => {
  it('returns the highlighted option when the index is valid', () => {
    expect(resolveEnterSelection(VOICES, 1)).toBe(VOICES[1])
  })

  it('returns the sole option when nothing is highlighted but exactly one match remains', () => {
    expect(resolveEnterSelection([VOICES[2]], -1)).toBe(VOICES[2])
  })

  it('returns null when nothing is highlighted and there are multiple matches', () => {
    expect(resolveEnterSelection(VOICES, -1)).toBeNull()
  })

  it('returns null when nothing is highlighted and there are zero matches', () => {
    expect(resolveEnterSelection([], -1)).toBeNull()
  })

  it('returns null when the highlight index is out of bounds and there is more than one match', () => {
    expect(resolveEnterSelection(VOICES, 10)).toBeNull()
  })
})
