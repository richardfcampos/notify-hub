/**
 * Admin dashboard entrypoint (DBCH-09, tasks.md D10). Loads config + status
 * + channel types on start, wires the add-channel/add-profile buttons and
 * the save bar, and re-renders channels/profiles whenever the underlying
 * config is replaced wholesale (initial load, discard, add, delete, or a
 * post-save refetch). Per-field edits mutate the shared config in place
 * (see admin-state.js) so typing never triggers a full re-render.
 */
import { el, clear } from './admin-dom.js'
import { fetchConfig, fetchChannelTypes } from './admin-api.js'
import { setConfigFromServer, getConfig, markEdited } from './admin-state.js'
import { renderChannelGrid } from './admin-channels.js'
import { renderProfilesList, wireAddProfileButton } from './admin-profiles.js'
import { wireAddChannelButton } from './admin-add-channel.js'
import { pruneDefaultChannelsToEnabled } from './admin-defaults.js'
import { refreshStatus } from './admin-status.js'
import { wireSaveBar } from './admin-save-flow.js'
import { showToast } from './admin-toast.js'

/** type -> required config key list, from GET /api/channel-types. */
let requiredConfigByType = {}
/** Registry type names, in server-registry order, for the Add-channel type picker. */
let channelTypeNames = []

function isEmptyConfig(config) {
  return config.channels.length === 0 && config.profiles.length === 0
}

function renderEmptyBanner(config) {
  const bannerArea = document.getElementById('banner-area')
  clear(bannerArea)
  if (isEmptyConfig(config)) {
    bannerArea.appendChild(
      el('div', { class: 'banner', role: 'status' }, 'No channels yet -- add one below and Save to make it live.')
    )
  }
}

function deleteChannel(config, id) {
  const index = config.channels.findIndex((c) => c.id === id)
  if (index !== -1) {
    config.channels.splice(index, 1)
  }
}

function channelCallbacks(config) {
  return {
    onToggle: () => {
      pruneDefaultChannelsToEnabled(config)
      renderProfilesList(config)
    },
    onDelete: (id) => {
      deleteChannel(config, id)
      markEdited()
      pruneDefaultChannelsToEnabled(config)
      renderAll(config)
    }
  }
}

function renderAll(config) {
  renderChannelGrid(config, requiredConfigByType, channelCallbacks(config))
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

async function loadChannelTypes() {
  const res = await fetchChannelTypes()
  if (!res.ok || !res.data) {
    showToast('failed to load channel types -- Add channel is unavailable until this succeeds', 'error')
    return
  }
  channelTypeNames = res.data.types.map((t) => t.type)
  requiredConfigByType = Object.fromEntries(res.data.types.map((t) => [t.type, t.requiredConfig]))
  // Field warnings/config fields depend on requiredConfigByType, so re-render
  // once it lands (a load that started before this resolved would otherwise
  // show every card with zero config fields).
  if (getConfig()) {
    renderAll(getConfig())
  }
}

async function refreshAll() {
  await Promise.all([loadConfig(), refreshStatus()])
}

function init() {
  void loadChannelTypes()

  wireAddChannelButton(getConfig, () => channelTypeNames, () => renderAll(getConfig()))
  wireAddProfileButton(getConfig)
  wireSaveBar({
    onSaved: refreshAll,
    onDiscarded: (config) => renderAll(config),
    getRequiredConfigByType: () => requiredConfigByType
  })

  document.getElementById('refresh-btn').addEventListener('click', () => {
    void refreshAll()
  })

  void refreshAll()
}

document.addEventListener('DOMContentLoaded', init)
