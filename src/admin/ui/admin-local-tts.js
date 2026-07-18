/**
 * `local-tts` channel-card special case (spec LTTS-03): the LOCAL_TTS_VOICE
 * field renders as a live `<select>` of installed voices instead of free
 * text, sourced from the player through the admin backend proxy (GET
 * /api/local-tts/voices?url=<LOCAL_TTS_URL>) -- eliminates the ambiguous-
 * voice-name bug this feature exists to fix. Falls back to the normal
 * masked text input (same styling as every other field) whenever the
 * player can't be reached, returns zero voices, or LOCAL_TTS_URL is still
 * empty, so the form is never blocked on a live dependency.
 */
import { el, clear } from './admin-dom.js'
import { fieldRow, labelFor } from './admin-field-row.js'
import { fetchLocalTtsVoices } from './admin-api.js'
import { markEdited } from './admin-state.js'

export const LOCAL_TTS_URL_KEY = 'LOCAL_TTS_URL'
export const LOCAL_TTS_VOICE_KEY = 'LOCAL_TTS_VOICE'

/**
 * Pure transform: the proxy route's response body -> select option
 * descriptors (`{value, label, selected}`), or `null` when the caller
 * should fall back to a plain text input instead of a dropdown --
 * `voicesResponse` missing entirely (fetch itself failed), `reachable:
 * false`, or a zero-length voices list all mean "no usable live list".
 * When `currentValue` doesn't match any returned voice's exact name, it is
 * still appended as a manually-added, pre-selected option so an existing
 * (possibly stale) config value is never silently dropped from the form.
 */
export function buildVoiceOptions(voicesResponse, currentValue) {
  const voices = voicesResponse?.reachable === false ? [] : voicesResponse?.voices
  if (!Array.isArray(voices) || voices.length === 0) {
    return null
  }

  const options = voices.map((voice) => ({
    value: voice.name,
    label: `${voice.name} (${voice.locale})`,
    selected: voice.name === currentValue
  }))

  if (currentValue && !options.some((option) => option.selected)) {
    options.push({ value: currentValue, label: currentValue, selected: true })
  }

  return options
}

/**
 * Renders the LOCAL_TTS_VOICE row into `outer` (cleared and rebuilt each
 * time) as a `<select>` from `options`. When nothing is selected yet (a
 * freshly added instance with a blank voice), the first option is silently
 * defaulted into `channel.config` -- WITHOUT calling `markEdited()` -- so a
 * Save triggered by some other edit (enabling the channel, editing the
 * label, ...) ships a real voice instead of a blank one; merely resolving
 * this fetch must never by itself flag the form dirty.
 */
function renderSelect(outer, channel, options, onFieldChange) {
  clear(outer)
  const selectId = `field-${channel.id}-${LOCAL_TTS_VOICE_KEY}`

  if (!channel.config[LOCAL_TTS_VOICE_KEY] && options.length > 0) {
    channel.config[LOCAL_TTS_VOICE_KEY] = options[0].value
    options[0].selected = true
  }

  const select = el(
    'select',
    {
      id: selectId,
      class: 'voice-select',
      onchange: (e) => {
        channel.config[LOCAL_TTS_VOICE_KEY] = e.target.value
        markEdited()
        onFieldChange()
      }
    },
    options.map((option) => el('option', { value: option.value, selected: option.selected }, option.label))
  )

  outer.appendChild(el('label', { class: 'field-label', for: selectId }, labelFor(LOCAL_TTS_VOICE_KEY)))
  outer.appendChild(select)
}

/** Falls back to the normal masked text input; `hintMessage` (optional) explains why, non-blocking. */
function renderFallback(outer, channel, onFieldChange, hintMessage) {
  clear(outer)
  outer.appendChild(fieldRow(channel, LOCAL_TTS_VOICE_KEY, onFieldChange))
  if (hintMessage) {
    outer.appendChild(el('p', { class: 'field-hint' }, hintMessage))
  }
}

/**
 * Renders the LOCAL_TTS_VOICE field for a `local-tts` channel card.
 * `element` mounts once into the card's fields-wrap; `refetch()` is called
 * by the LOCAL_TTS_URL field's blur handler so picking the player URL
 * first, then getting a live voice list, works naturally -- and is also
 * called once immediately to populate on first render.
 */
export function renderLocalTtsVoiceField(channel, onFieldChange) {
  const outer = el('div', { class: 'field-row local-tts-voice-field' })

  async function refetch() {
    const url = channel.config[LOCAL_TTS_URL_KEY]?.trim()
    if (!url) {
      renderFallback(outer, channel, onFieldChange)
      return
    }

    const res = await fetchLocalTtsVoices(url)
    const options = buildVoiceOptions(res.ok ? res.data : null, channel.config[LOCAL_TTS_VOICE_KEY])
    if (!options) {
      renderFallback(outer, channel, onFieldChange, 'player unreachable -- enter voice name manually')
      return
    }
    renderSelect(outer, channel, options, onFieldChange)
  }

  renderFallback(outer, channel, onFieldChange)
  void refetch()

  return { element: outer, refetch }
}
