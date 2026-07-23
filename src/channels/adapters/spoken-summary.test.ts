/**
 * Tests derive from spec VNR-01's ACs: title with a leading emoji/symbol
 * run is stripped (Unicode-aware, real multi-codepoint emoji included);
 * title with no leading symbols is returned as-is; no/empty title falls
 * back to `message`; a title that's ONLY symbols returns the stripped
 * (possibly near-empty) remainder without throwing or falling back.
 */
import { describe, expect, it } from 'vitest'
import { spokenSummary } from './spoken-summary.js'

describe('spokenSummary', () => {
  it('strips the leading emoji + space from a real hook-formatted title (done status)', () => {
    expect(
      spokenSummary({ title: '✅ notify-hub — concluído', message: 'Início: ... Fim: ...' })
    ).toBe('notify-hub — concluído')
  })

  it('strips the leading emoji + space from a real hook-formatted title (needs-input status)', () => {
    expect(
      spokenSummary({
        title: '🙋 jetsales-ai-first — precisa de você',
        message: 'Aguardando decisão sobre X'
      })
    ).toBe('jetsales-ai-first — precisa de você')
  })

  it('strips a phase-complete emoji title too', () => {
    expect(
      spokenSummary({ title: '🏁 grosify — fase 2/4 concluída', message: 'Backend pronto' })
    ).toBe('grosify — fase 2/4 concluída')
  })

  it('returns the title unchanged when it has no leading emoji/symbols', () => {
    expect(spokenSummary({ title: 'Build finished', message: 'All tests passed' })).toBe(
      'Build finished'
    )
  })

  it('falls back to message when title is an empty string', () => {
    expect(spokenSummary({ title: '', message: 'All tests passed' })).toBe('All tests passed')
  })

  it('falls back to message when title is undefined', () => {
    expect(
      spokenSummary({ title: undefined as unknown as string, message: 'All tests passed' })
    ).toBe('All tests passed')
  })

  it('returns the stripped (near-empty) remainder for a title that is only symbols/emoji, without throwing or falling back to message', () => {
    expect(() => spokenSummary({ title: '✅✅✅', message: 'should not be used' })).not.toThrow()
    expect(spokenSummary({ title: '✅✅✅', message: 'should not be used' })).toBe('')
  })

  it('strips leading symbols but preserves internal punctuation like the em-dash', () => {
    expect(spokenSummary({ title: '🤔 fable — decisão necessária', message: 'm' })).toBe(
      'fable — decisão necessária'
    )
  })
})
