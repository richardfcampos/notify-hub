/**
 * Sticky "unsaved changes" bar + the Save pipeline (DBCH-08/09, tasks.md
 * D10): PUT /api/config with the assembled working state -- validate +
 * diff-apply is atomic and server-side, and there is NO separate apply/
 * restart step (AD-018 hot-reload: the save is live for the very next
 * request/delivery). A 400 means nothing was written -- its message
 * (channel/profile + key, named per spec) is shown verbatim.
 */
import { saveConfig } from './admin-api.js'
import { getConfig, isDirty, markSaved, discardEdits, onStateChange } from './admin-state.js'
import { assembleConfigPayload } from './admin-config-payload.js'
import { showToast } from './admin-toast.js'

let onSavedCallback = async () => {}
let getRequiredConfigByTypeCallback = () => ({})

function setStep(text) {
  document.getElementById('save-steps').textContent = text
}

function setBarVisible(visible) {
  document.getElementById('save-bar').classList.toggle('visible', visible)
}

function setButtonsDisabled(disabled) {
  document.getElementById('save-btn').disabled = disabled
  document.getElementById('discard-btn').disabled = disabled
}

async function runSave() {
  setButtonsDisabled(true)
  setStep('saving…')

  const payload = assembleConfigPayload(getConfig(), getRequiredConfigByTypeCallback())
  const saveRes = await saveConfig(payload)

  setStep('')
  setButtonsDisabled(false)

  if (!saveRes.ok) {
    showToast(saveRes.data?.error ?? `save failed (status ${saveRes.status})`, 'error')
    return
  }

  markSaved()
  showToast('saved — live immediately', 'success')
  await onSavedCallback()
}

/**
 * Wires the sticky bar buttons and subscribes it to dirty-state changes.
 * `onSaved` re-fetches config+status after a successful save; `onDiscarded`
 * re-renders the grid/profiles from the reverted snapshot;
 * `getRequiredConfigByType` supplies the type -> required-key map (from
 * GET /api/channel-types) used to assemble the PUT payload.
 */
export function wireSaveBar({ onSaved, onDiscarded, getRequiredConfigByType }) {
  onSavedCallback = onSaved
  getRequiredConfigByTypeCallback = getRequiredConfigByType ?? getRequiredConfigByTypeCallback

  document.getElementById('save-btn').addEventListener('click', () => {
    void runSave()
  })

  document.getElementById('discard-btn').addEventListener('click', () => {
    discardEdits()
    onDiscarded(getConfig())
  })

  onStateChange(() => setBarVisible(isDirty()))
}
