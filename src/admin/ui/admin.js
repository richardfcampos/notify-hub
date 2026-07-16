/**
 * Admin dashboard entrypoint (ADMIN-07). Loads config + status on start,
 * wires the refresh button and the save bar, and re-renders channels/
 * profiles whenever the underlying config is replaced wholesale (initial
 * load, discard, or a post-apply refetch). Per-field edits mutate the
 * shared config in place (see admin-state.js) so typing never triggers a
 * full re-render.
 */
import { el, clear } from './admin-dom.js'
import { fetchConfig } from './admin-api.js'
import { setConfigFromServer, getConfig } from './admin-state.js'
import { renderChannelGrid } from './admin-channels.js'
import { renderProfilesList, wireAddProfileButton } from './admin-profiles.js'
import { pruneDefaultChannelsToEnabled } from './admin-defaults.js'
import { refreshStatus } from './admin-status.js'
import { wireSaveBar } from './admin-save-flow.js'
import { showToast } from './admin-toast.js'

function isEmptyConfig(config) {
  const noProfiles = config.profiles.length === 0
  const noExtraKeys = Object.keys(config.extraKeys).length === 0
  const allChannelsEmpty = Object.values(config.channels).every(
    (entry) => !entry.enabled && Object.values(entry.values).every((v) => v === '')
  )
  return noProfiles && noExtraKeys && allChannelsEmpty
}

function renderEmptyBanner(config) {
  const bannerArea = document.getElementById('banner-area')
  clear(bannerArea)
  if (isEmptyConfig(config)) {
    bannerArea.appendChild(
      el(
        'div',
        { class: 'banner', role: 'status' },
        'No .env yet -- configure channels below and Save & Apply to create it.'
      )
    )
  }
}

function renderAll(config) {
  // On a channel enable/disable flip, drop any now-disabled channel from
  // every profile's defaults before re-rendering the chips -- otherwise a
  // disabled channel stays silently selected and fails validation on save.
  renderChannelGrid(config, () => {
    pruneDefaultChannelsToEnabled(config)
    renderProfilesList(config)
  })
  renderProfilesList(config)
  renderEmptyBanner(config)
}

async function loadConfig() {
  const res = await fetchConfig()
  if (!res.ok || !res.data) {
    showToast('failed to load configuration from the admin server', 'error')
    return
  }
  setConfigFromServer(res.data)
  renderAll(getConfig())
}

async function refreshAll() {
  await Promise.all([loadConfig(), refreshStatus()])
}

function init() {
  wireAddProfileButton(getConfig)
  wireSaveBar({
    onSaved: refreshAll,
    onDiscarded: (config) => renderAll(config)
  })

  document.getElementById('refresh-btn').addEventListener('click', () => {
    void refreshAll()
  })

  void refreshAll()
}

document.addEventListener('DOMContentLoaded', init)
