/**
 * Pure transform test (spec LTTS-03/LTTS-05): proxy response -> combobox
 * option list (including a searchText for type-to-filter), or `null` when
 * the caller should fall back to a plain text input instead. Mirrors
 * admin-channel-completeness.test.js's style (no DOM needed --
 * `renderLocalTtsVoiceField` itself is DOM-heavy and exercised live, not
 * unit-tested here).
 */
import { describe, expect, it } from 'vitest'
import { buildVoiceOptions } from './admin-local-tts.js'

const TWO_VOICES = [
  { name: 'Luciana', locale: 'pt_BR', sample: 'Ola, como vai?' },
  { name: 'Grandma (Portuguese (Brazil))', locale: 'pt_BR', sample: 'Ola' }
]

describe('buildVoiceOptions', () => {
  it('returns null when the fetch itself failed (no response at all)', () => {
    expect(buildVoiceOptions(undefined, 'Luciana')).toBeNull()
    expect(buildVoiceOptions(null, 'Luciana')).toBeNull()
  })

  it('returns null when the proxy reports the player is unreachable', () => {
    expect(buildVoiceOptions({ voices: [], reachable: false }, 'Luciana')).toBeNull()
  })

  it('returns null when the player is reachable but has zero voices', () => {
    expect(buildVoiceOptions({ voices: [], reachable: true }, '')).toBeNull()
  })

  it('builds one option per voice with a locale-qualified label and a name+locale+sample searchText', () => {
    const options = buildVoiceOptions({ voices: TWO_VOICES, reachable: true }, '')
    expect(options).toEqual([
      { value: 'Luciana', label: 'Luciana (pt_BR)', selected: false, searchText: 'Luciana pt_BR Ola, como vai?' },
      {
        value: 'Grandma (Portuguese (Brazil))',
        label: 'Grandma (Portuguese (Brazil)) (pt_BR)',
        selected: false,
        searchText: 'Grandma (Portuguese (Brazil)) pt_BR Ola'
      }
    ])
  })

  it('pre-selects the option matching the current value', () => {
    const options = buildVoiceOptions({ voices: TWO_VOICES, reachable: true }, 'Grandma (Portuguese (Brazil))')
    expect(options.find((o) => o.selected)).toEqual({
      value: 'Grandma (Portuguese (Brazil))',
      label: 'Grandma (Portuguese (Brazil)) (pt_BR)',
      selected: true,
      searchText: 'Grandma (Portuguese (Brazil)) pt_BR Ola'
    })
  })

  it('appends an unmatched current value as a manual, pre-selected option instead of dropping it', () => {
    const options = buildVoiceOptions({ voices: TWO_VOICES, reachable: true }, 'Some Old Voice')
    expect(options).toHaveLength(3)
    expect(options.at(-1)).toEqual({
      value: 'Some Old Voice',
      label: 'Some Old Voice',
      selected: true,
      searchText: 'Some Old Voice'
    })
  })

  it('does not append or pre-select anything when the current value is blank', () => {
    const options = buildVoiceOptions({ voices: TWO_VOICES, reachable: true }, '')
    expect(options).toHaveLength(2)
    expect(options.every((o) => !o.selected)).toBe(true)
  })
})
