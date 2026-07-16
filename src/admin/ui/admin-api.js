/**
 * Thin fetch wrapper for the admin API (ADMIN-02..06, DBCH-08/09). Every
 * function resolves -- never rejects -- with a uniform `{ok, status, data}`
 * shape so call sites don't need try/catch: a network failure (admin server
 * restarting, gateway unreachable) degrades to `{ok:false, status:0,
 * data:{error:message}}` instead of throwing and breaking the rest of the
 * panel. `saveConfig` is now the only write path -- there is no separate
 * apply step (a save is live immediately).
 */

async function request(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }

    return { ok: res.ok, status: res.status, data }
  } catch (error) {
    return { ok: false, status: 0, data: { error: error instanceof Error ? error.message : String(error) } }
  }
}

export const fetchConfig = () => request('GET', '/api/config')
export const saveConfig = (cfg) => request('PUT', '/api/config', cfg)
export const fetchStatus = () => request('GET', '/api/status')
export const fetchChannelTypes = () => request('GET', '/api/channel-types')
export const sendTest = (channelId) => request('POST', '/api/test-send', { channelId })
