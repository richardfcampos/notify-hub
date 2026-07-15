/**
 * Renders header status (gateway pill, active channel count) and the
 * recent-deliveries tail from GET /api/status (ADMIN-06). A gateway that's
 * unreachable degrades the pill to red without touching the rest of the
 * panel (AC ADMIN-06.2) -- this module never throws on a failed fetch.
 */
import { el, clear } from './admin-dom.js'
import { fetchStatus } from './admin-api.js'

function relativeTime(iso) {
  if (!iso) {
    return ''
  }
  const deltaMs = Date.now() - Date.parse(iso)
  if (!Number.isFinite(deltaMs)) {
    return ''
  }
  const seconds = Math.max(0, Math.round(deltaMs / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

function renderDeliveries(events) {
  const list = document.getElementById('deliveries-list')
  clear(list)

  if (events.length === 0) {
    list.appendChild(el('p', { class: 'muted empty-state' }, 'No recent deliveries.'))
    return
  }

  for (const event of [...events].reverse()) {
    const status = event.ok ? '✅' : '❌'
    const detail = event.ok ? '' : ` -- ${event.error ?? 'unknown error'}`
    list.appendChild(
      el('div', { class: `delivery-line${event.ok ? '' : ' delivery-fail'}` }, [
        el('span', { class: 'delivery-text' }, `${status} ${event.channel}${detail}`),
        el('span', { class: 'muted delivery-time' }, relativeTime(event.time))
      ])
    )
  }
}

function setPill(pillEl, up, redis) {
  pillEl.className = `pill ${up ? 'pill-up' : 'pill-down'}`
  if (up) {
    pillEl.textContent = redis === false ? 'gateway up · redis down' : 'gateway up · redis ok'
  } else {
    pillEl.textContent = 'gateway down'
  }
}

/** Fetches /api/status and updates the pill, channel count and deliveries list. Never throws -- a fetch failure just leaves the pill red and the list empty. */
export async function refreshStatus() {
  const pill = document.getElementById('gateway-pill')
  const countEl = document.getElementById('channel-count')
  const res = await fetchStatus()

  if (!res.ok || !res.data) {
    setPill(pill, false)
    countEl.textContent = ''
    renderDeliveries([])
    return
  }

  const { gateway, channels = [], recentDeliveries = [] } = res.data
  setPill(pill, gateway?.up === true, gateway?.redis)
  countEl.textContent = `${channels.length} active channel${channels.length === 1 ? '' : 's'}`
  renderDeliveries(recentDeliveries)
}
