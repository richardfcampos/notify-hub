/**
 * Non-blocking toast notifications (ADMIN-07: "errors as non-blocking
 * toasts"). Used for save/apply/validation failures and small confirmations
 * (e.g. "token copied") -- never blocks the rest of the panel, always
 * auto-dismisses, and can also be dismissed manually.
 */
import { el } from './admin-dom.js'

const AUTO_DISMISS_MS = 6000

/** Appends a toast of `kind` ('error' | 'success' | 'info') with `message`, verbatim (server validation messages name the offending channel/key and should reach the operator unmodified). */
export function showToast(message, kind = 'error') {
  const area = document.getElementById('toast-area')
  if (!area) {
    return
  }

  const toast = el('div', { class: `toast toast-${kind}`, role: 'status' }, [el('span', { class: 'toast-text' }, message)])
  const closeBtn = el(
    'button',
    { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss notification', onclick: () => toast.remove() },
    '×'
  )
  toast.appendChild(closeBtn)

  area.appendChild(toast)
  setTimeout(() => toast.remove(), AUTO_DISMISS_MS)
}
