/**
 * "Add channel" inline flow (DBCH-09, tasks.md D10): pick a type, type a
 * label (auto-slugifies a suggested id live, unless the operator has
 * already hand-edited the id field), confirm -> a new, disabled instance
 * (empty config) is pushed into the working state, dirty. Toggling the
 * button a second time closes the form without adding anything.
 */
import { el, clear } from './admin-dom.js'
import { markEdited } from './admin-state.js'
import { isValidChannelId, slugify } from './admin-instance-id.js'

function validationError(id, label, existingIds) {
  if (label.length === 0) {
    return 'label is required'
  }
  if (id.length === 0) {
    return 'id is required'
  }
  if (!isValidChannelId(id)) {
    return 'id must start with a lowercase letter/digit and contain only lowercase letters, digits and hyphens'
  }
  if (existingIds.has(id)) {
    return `id "${id}" already exists`
  }
  return ''
}

function buildForm(channelTypes, existingIds, onAdd, onCancel) {
  let idEditedManually = false

  const typeSelect = el(
    'select',
    { class: 'add-channel-type', 'aria-label': 'Channel type' },
    channelTypes.map((type) => el('option', { value: type }, type))
  )

  const errorArea = el('p', { class: 'add-channel-error' })
  const addBtn = el('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Add')

  function refresh() {
    const error = validationError(idInput.value.trim(), labelInput.value.trim(), existingIds)
    errorArea.textContent = error
    addBtn.disabled = error !== ''
  }

  const labelInput = el('input', {
    type: 'text',
    class: 'add-channel-label',
    placeholder: 'Label (e.g. Acme Slack)',
    oninput: () => {
      if (!idEditedManually) {
        idInput.value = slugify(labelInput.value)
      }
      refresh()
    }
  })

  const idInput = el('input', {
    type: 'text',
    class: 'add-channel-id mono',
    placeholder: 'id (e.g. acme-slack)',
    oninput: () => {
      idEditedManually = true
      refresh()
    }
  })

  addBtn.addEventListener('click', () => {
    const id = idInput.value.trim()
    const label = labelInput.value.trim()
    if (validationError(id, label, existingIds) !== '') {
      return
    }
    onAdd({ id, label, type: typeSelect.value })
  })

  const cancelBtn = el('button', { class: 'btn btn-ghost', type: 'button', onclick: onCancel }, 'Cancel')

  refresh()

  return el('div', { class: 'add-channel-form' }, [
    el('div', { class: 'add-channel-row' }, [typeSelect, labelInput, idInput]),
    errorArea,
    el('div', { class: 'add-channel-actions' }, [addBtn, cancelBtn])
  ])
}

/**
 * Wires the "Add channel" button to toggle an inline form in
 * `#add-channel-area`. `getChannelTypes()` is called lazily (returns `[]`
 * until GET /api/channel-types resolves) so an early click before load just
 * shows an empty type dropdown rather than throwing. `onAdded()` runs after
 * a successful add so the caller re-renders the grid/profiles.
 */
export function wireAddChannelButton(getConfig, getChannelTypes, onAdded) {
  const area = document.getElementById('add-channel-area')
  const button = document.getElementById('add-channel-btn')

  button.addEventListener('click', () => {
    if (area.childNodes.length > 0) {
      clear(area)
      return
    }

    const config = getConfig()
    if (!config) {
      return
    }
    const existingIds = new Set(config.channels.map((c) => c.id))

    const form = buildForm(
      getChannelTypes(),
      existingIds,
      (draft) => {
        config.channels.push({ id: draft.id, label: draft.label, type: draft.type, enabled: false, config: {} })
        markEdited()
        clear(area)
        onAdded()
      },
      () => clear(area)
    )
    area.appendChild(form)
  })
}
