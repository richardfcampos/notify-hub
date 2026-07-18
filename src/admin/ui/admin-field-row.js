/**
 * Shared masked/reveal/copy config-field row builder (ADMIN-07). Extracted
 * out of admin-channels.js so both the generic channel-card field renderer
 * and the local-tts voice-field special case (admin-local-tts.js) build
 * LOCAL_TTS_URL -- and the LOCAL_TTS_VOICE fallback text input -- with the
 * EXACT same masked input + eye-reveal + copy treatment as every other field
 * (e.g. SLACK_WEBHOOK_URL), instead of duplicating that wiring at a second
 * call site.
 */
import { el } from './admin-dom.js'
import { ICON_EYE, ICON_EYE_OFF, ICON_COPY } from './admin-icons.js'
import { markEdited } from './admin-state.js'
import { showToast } from './admin-toast.js'

/** `NTFY_TOPIC` -> `Ntfy Topic` -- readable label for a raw config key. */
export function labelFor(key) {
  return key
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Masked text input + eye-reveal + copy for one config key of `channel`.
 * `onBlur` (optional) additionally fires with the current value when the
 * input loses focus -- used by the LOCAL_TTS_URL field to re-fetch the
 * voice dropdown once the operator finishes typing/pasting the player URL.
 */
export function fieldRow(channel, key, onFieldChange, onBlur) {
  const inputAttrs = {
    type: 'password',
    id: `field-${channel.id}-${key}`,
    value: channel.config[key] ?? '',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: (e) => {
      channel.config[key] = e.target.value
      markEdited()
      onFieldChange()
    }
  }
  if (onBlur) {
    inputAttrs.onblur = (e) => onBlur(e.target.value)
  }
  const input = el('input', inputAttrs)

  const eyeBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-pressed': 'false',
    'aria-label': `Reveal ${key}`,
    html: ICON_EYE,
    onclick: (e) => {
      const revealed = input.type === 'text'
      input.type = revealed ? 'password' : 'text'
      e.currentTarget.setAttribute('aria-pressed', String(!revealed))
      e.currentTarget.innerHTML = revealed ? ICON_EYE : ICON_EYE_OFF
    }
  })

  const copyBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': `Copy ${key}`,
    html: ICON_COPY,
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(input.value)
        showToast(`${key} copied`, 'info')
      } catch {
        showToast('copy failed -- clipboard unavailable', 'error')
      }
    }
  })

  return el('div', { class: 'field-row' }, [
    el('label', { class: 'field-label', for: input.id }, labelFor(key)),
    el('div', { class: 'field-input-group' }, [input, eyeBtn, copyBtn])
  ])
}
