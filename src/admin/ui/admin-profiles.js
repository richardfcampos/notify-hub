/**
 * Renders the profiles/tokens section (DBCH-09, tasks.md D10): one card per
 * profile with a name input, masked+reveal+copy token, and toggleable
 * default-channel chips listing EVERY channel instance (not just enabled
 * ones -- an operator can pre-select a not-yet-enabled instance; the id
 * shows as a tooltip since the label is what's displayed). Add/remove
 * mutate config.profiles and force a section re-render (cheap: a handful of
 * profiles); field edits and chip toggles mutate in place without
 * re-rendering so typing keeps focus.
 */
import { el, clear } from './admin-dom.js'
import { ICON_EYE, ICON_EYE_OFF, ICON_COPY, ICON_TRASH } from './admin-icons.js'
import { markEdited } from './admin-state.js'
import { showToast } from './admin-toast.js'

function chip(channel, profile) {
  const active = profile.defaultChannels.includes(channel.id)
  return el(
    'button',
    {
      type: 'button',
      class: `chip-toggle${active ? ' active' : ''}`,
      title: channel.id,
      'aria-pressed': String(active),
      onclick: (e) => {
        const idx = profile.defaultChannels.indexOf(channel.id)
        const willBeActive = idx === -1
        if (willBeActive) {
          profile.defaultChannels.push(channel.id)
        } else {
          profile.defaultChannels.splice(idx, 1)
        }
        markEdited()
        e.currentTarget.classList.toggle('active', willBeActive)
        e.currentTarget.setAttribute('aria-pressed', String(willBeActive))
      }
    },
    channel.label || channel.id
  )
}

function profileCard(profile, index, config, rerender) {
  const tokenInput = el('input', {
    type: 'password',
    class: 'profile-token-input',
    value: profile.token,
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'token',
    oninput: (e) => {
      profile.token = e.target.value
      markEdited()
    }
  })

  const nameInput = el('input', {
    type: 'text',
    class: 'profile-name-input',
    value: profile.name,
    placeholder: 'profile name',
    oninput: (e) => {
      profile.name = e.target.value
      markEdited()
    }
  })

  const eyeBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-pressed': 'false',
    'aria-label': 'Reveal token',
    html: ICON_EYE,
    onclick: (e) => {
      const revealed = tokenInput.type === 'text'
      tokenInput.type = revealed ? 'password' : 'text'
      e.currentTarget.setAttribute('aria-pressed', String(!revealed))
      e.currentTarget.innerHTML = revealed ? ICON_EYE : ICON_EYE_OFF
    }
  })

  const copyBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': 'Copy token',
    html: ICON_COPY,
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(tokenInput.value)
        showToast('token copied', 'info')
      } catch {
        showToast('copy failed -- clipboard unavailable', 'error')
      }
    }
  })

  const removeBtn = el('button', {
    class: 'icon-btn icon-btn-danger',
    type: 'button',
    'aria-label': `Remove profile ${profile.name || index + 1}`,
    html: ICON_TRASH,
    onclick: () => {
      config.profiles.splice(index, 1)
      markEdited()
      rerender()
    }
  })

  const chipsRow = el(
    'div',
    { class: 'chips-row' },
    config.channels.map((channel) => chip(channel, profile))
  )

  return el('article', { class: 'card profile-card' }, [
    el('div', { class: 'profile-row' }, [nameInput, tokenInput, eyeBtn, copyBtn, removeBtn]),
    el('div', { class: 'field-label' }, 'Default channels'),
    chipsRow.childNodes.length > 0 ? chipsRow : el('p', { class: 'muted empty-state' }, 'no channels yet')
  ])
}

/** Renders every profile card into #profiles-list (empty state when there are none). */
export function renderProfilesList(config) {
  const container = document.getElementById('profiles-list')
  clear(container)

  if (config.profiles.length === 0) {
    container.appendChild(el('p', { class: 'muted empty-state' }, 'No profiles yet -- add one to generate a token.'))
    return
  }

  config.profiles.forEach((profile, index) => {
    container.appendChild(profileCard(profile, index, config, () => renderProfilesList(config)))
  })
}

/** Generates a profile id independent of the (editable) name/token -- not shown in the UI, just the DB primary key/join-table anchor. */
function generateProfileId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Wires the "Add profile" button; `getCurrentConfig` is called lazily on click so it always reads the live config reference (not one captured at wiring time, before the first load completes). */
export function wireAddProfileButton(getCurrentConfig) {
  document.getElementById('add-profile-btn').addEventListener('click', () => {
    const config = getCurrentConfig()
    if (!config) {
      return
    }
    config.profiles.push({ id: generateProfileId(), name: '', token: '', defaultChannels: [] })
    markEdited()
    renderProfilesList(config)
  })
}
