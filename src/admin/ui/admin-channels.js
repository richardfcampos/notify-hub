/**
 * Renders the channel grid (ADMIN-07): one card per registry channel from
 * the current AdminConfig. Each required key is a masked field with
 * eye-reveal + copy; the enabled toggle expands/collapses the fields via a
 * CSS class (no re-render); "Send test" shows a spinner then the real
 * ✅/❌ outcome from POST /api/test-send. Field/toggle edits mutate the
 * shared config object in place and call markEdited() -- the grid itself is
 * only rebuilt on a fresh load/discard (admin.js), so typing never loses
 * focus.
 */
import { el, clear } from './admin-dom.js'
import { ICON_EYE, ICON_EYE_OFF, ICON_COPY, ICON_CHECK, ICON_CROSS, ICON_SPINNER } from './admin-icons.js'
import { markEdited } from './admin-state.js'
import { sendTest } from './admin-api.js'
import { showToast } from './admin-toast.js'

/** `NTFY_TOPIC` -> `Ntfy Topic` -- readable label for a raw env key. */
function labelFor(key) {
  return key
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ')
}

function fieldRow(name, key, entry) {
  const input = el('input', {
    type: 'password',
    id: `field-${name}-${key}`,
    value: entry.values[key] ?? '',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: (e) => {
      entry.values[key] = e.target.value
      markEdited()
    }
  })

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

function resultChip(state, detail) {
  if (state === 'pending') {
    return el('span', { class: 'chip chip-pending', html: ICON_SPINNER })
  }
  if (state === 'ok') {
    return el('span', { class: 'chip chip-ok' }, [el('span', { html: ICON_CHECK }), ' delivered'])
  }
  return el('span', { class: 'chip chip-fail', title: detail ?? '' }, [el('span', { html: ICON_CROSS }), ` ${detail ?? 'failed'}`])
}

function renderCard(name, entry, onToggle) {
  const fieldsWrap = el(
    'div',
    { class: `fields-wrap${entry.enabled ? '' : ' collapsed'}` },
    Object.keys(entry.values).map((key) => fieldRow(name, key, entry))
  )

  const resultArea = el('span', { class: 'test-result' })

  const testBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-test',
      type: 'button',
      disabled: !entry.enabled,
      onclick: async () => {
        clear(resultArea)
        resultArea.appendChild(resultChip('pending'))
        const res = await sendTest(name)
        clear(resultArea)
        if (res.ok && res.data) {
          resultArea.appendChild(resultChip(res.data.ok ? 'ok' : 'fail', res.data.detail))
        } else {
          resultArea.appendChild(resultChip('fail', res.data?.error ?? 'request failed'))
        }
      }
    },
    'Send test'
  )

  const toggle = el('input', {
    type: 'checkbox',
    id: `toggle-${name}`,
    checked: entry.enabled,
    onchange: (e) => {
      entry.enabled = e.target.checked
      markEdited()
      fieldsWrap.classList.toggle('collapsed', !entry.enabled)
      testBtn.disabled = !entry.enabled
      onToggle()
    }
  })

  return el('article', { class: 'card channel-card' }, [
    el('header', { class: 'channel-card-header' }, [
      el('label', { class: 'switch', for: toggle.id }, [toggle, el('span', { class: 'switch-track' })]),
      el('span', { class: 'channel-name' }, name),
      testBtn,
      resultArea
    ]),
    fieldsWrap
  ])
}

/** Renders one card per registry channel, in registry order, into #channel-grid. `onToggle` runs after any enable/disable flip so the caller can refresh dependents (profiles' default-channel chips). */
export function renderChannelGrid(config, onToggle) {
  const grid = document.getElementById('channel-grid')
  clear(grid)
  for (const [name, entry] of Object.entries(config.channels)) {
    grid.appendChild(renderCard(name, entry, onToggle))
  }
}
