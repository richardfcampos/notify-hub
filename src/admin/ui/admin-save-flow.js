/**
 * Sticky "unsaved changes" bar + the Save & Apply pipeline (ADMIN-03,
 * ADMIN-04): PUT /api/config (validate + backup + write -- atomic and
 * server-side) then POST /api/apply (docker compose up -d). The step label
 * reflects the two real HTTP round trips; no synthetic sub-steps are
 * invented beyond what the server actually reports. A 400 from PUT means
 * nothing was written -- its message (channel + key, named per spec) is
 * shown verbatim and apply never runs.
 */
import { saveConfig, applyConfig } from './admin-api.js'
import { getConfig, isDirty, markSaved, discardEdits, onStateChange } from './admin-state.js'
import { showToast } from './admin-toast.js'

let onSavedCallback = async () => {}

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

async function runSaveAndApply() {
  setButtonsDisabled(true)
  setStep('validating & writing .env…')

  const saveRes = await saveConfig(getConfig())
  if (!saveRes.ok) {
    showToast(saveRes.data?.error ?? `save failed (status ${saveRes.status})`, 'error')
    setStep('')
    setButtonsDisabled(false)
    return
  }

  setStep('applying (docker compose up -d)…')
  const applyRes = await applyConfig()

  // The .env write already happened and its backup path is known even if
  // apply fails below, so the operator isn't left guessing (AC
  // "Save & Apply pipeline".3: apply failure still shows the write outcome).
  const backupNote = saveRes.data?.backupPath ? ` (backup: ${saveRes.data.backupPath})` : ''
  markSaved()
  setStep('')
  setButtonsDisabled(false)

  if (!applyRes.ok) {
    showToast(`.env saved but apply failed: ${applyRes.data?.output ?? 'unknown error'}${backupNote}`, 'error')
    return
  }

  showToast('saved & applied', 'success')
  await onSavedCallback()
}

/** Wires the sticky bar buttons and subscribes it to dirty-state changes.
 * `onSaved` re-fetches config+status after a successful apply (spec:
 * "re-fetch config+status"); `onDiscarded` re-renders the grid/profiles from
 * the reverted snapshot. */
export function wireSaveBar({ onSaved, onDiscarded }) {
  onSavedCallback = onSaved

  document.getElementById('save-btn').addEventListener('click', () => {
    void runSaveAndApply()
  })

  document.getElementById('discard-btn').addEventListener('click', () => {
    discardEdits()
    onDiscarded(getConfig())
  })

  onStateChange(() => setBarVisible(isDirty()))
}
