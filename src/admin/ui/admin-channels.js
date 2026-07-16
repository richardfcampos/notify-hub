/**
 * Renders the channel grid as named INSTANCE cards (DBCH-09, tasks.md D10):
 * header = editable label + immutable monospace id badge + type tag +
 * enabled toggle; body = masked config fields (eye-reveal + copy, same
 * components as before) for that instance's TYPE's required keys; footer =
 * Send test + Delete. Field/toggle/label edits mutate the shared config
 * object in place and call markEdited() -- the grid itself is only rebuilt
 * on a fresh load/discard/add/delete (admin.js), so typing never loses
 * focus.
 */
import { el, clear } from './admin-dom.js'
import { ICON_EYE, ICON_EYE_OFF, ICON_COPY, ICON_CHECK, ICON_CROSS, ICON_SPINNER, ICON_TRASH } from './admin-icons.js'
import { markEdited } from './admin-state.js'
import { sendTest } from './admin-api.js'
import { showToast } from './admin-toast.js'
import { missingRequiredKeys } from './admin-channel-completeness.js'

/** `NTFY_TOPIC` -> `Ntfy Topic` -- readable label for a raw config key. */
function labelFor(key) {
  return key
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ')
}

function fieldRow(channel, key, onFieldChange) {
  const input = el('input', {
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

function renderCard(channel, requiredConfig, callbacks) {
  const warningArea = el('p', { class: 'field-warning' })
  function renderWarning() {
    const missing = channel.enabled ? missingRequiredKeys(channel, requiredConfig) : []
    warningArea.textContent = missing.length > 0 ? `Missing: ${missing.map(labelFor).join(', ')}` : ''
  }
  renderWarning()

  const fieldsWrap = el(
    'div',
    { class: `fields-wrap${channel.enabled ? '' : ' collapsed'}` },
    requiredConfig.map((key) => fieldRow(channel, key, renderWarning))
  )

  const labelInput = el('input', {
    type: 'text',
    class: 'channel-label-input',
    value: channel.label,
    placeholder: 'label',
    oninput: (e) => {
      channel.label = e.target.value
      markEdited()
    }
  })

  const resultArea = el('span', { class: 'test-result' })

  const testBtn = el(
    'button',
    {
      class: 'btn btn-ghost btn-test',
      type: 'button',
      disabled: !channel.enabled,
      onclick: async () => {
        clear(resultArea)
        resultArea.appendChild(resultChip('pending'))
        const res = await sendTest(channel.id)
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

  const deleteBtn = el('button', {
    class: 'icon-btn icon-btn-danger',
    type: 'button',
    'aria-label': `Delete ${channel.label || channel.id}`,
    html: ICON_TRASH,
    onclick: () => callbacks.onDelete(channel.id)
  })

  const toggle = el('input', {
    type: 'checkbox',
    id: `toggle-${channel.id}`,
    checked: channel.enabled,
    onchange: (e) => {
      channel.enabled = e.target.checked
      markEdited()
      fieldsWrap.classList.toggle('collapsed', !channel.enabled)
      testBtn.disabled = !channel.enabled
      renderWarning()
      callbacks.onToggle()
    }
  })

  return el('article', { class: 'card channel-card' }, [
    el('header', { class: 'channel-card-header' }, [
      el('label', { class: 'switch', for: toggle.id }, [toggle, el('span', { class: 'switch-track' })]),
      labelInput,
      el('span', { class: 'id-badge mono', title: channel.id }, channel.id),
      el('span', { class: 'type-tag' }, channel.type)
    ]),
    fieldsWrap,
    warningArea,
    el('footer', { class: 'channel-card-footer' }, [testBtn, resultArea, deleteBtn])
  ])
}

/**
 * Renders one card per channel instance into #channel-grid, in `config.channels`
 * order. `requiredConfigByType` (from GET /api/channel-types) supplies each
 * instance's required config keys; an instance whose type is missing from
 * the map (shouldn't happen once channel-types has loaded) renders with no
 * config fields rather than throwing. `callbacks.onToggle()` runs after any
 * enable/disable flip and `callbacks.onDelete(id)` after Delete, so the
 * caller can refresh dependents (profiles' default-channel chips).
 */
export function renderChannelGrid(config, requiredConfigByType, callbacks) {
  const grid = document.getElementById('channel-grid')
  clear(grid)
  for (const channel of config.channels) {
    const requiredConfig = requiredConfigByType[channel.type] ?? []
    grid.appendChild(renderCard(channel, requiredConfig, callbacks))
  }
}
