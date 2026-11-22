// Cross-device sync through one file in the user's own private GitHub repo. No server of ours: the browser talks to
// api.github.com directly (it allows CORS with an Authorization header). The token never leaves this device's storage.
import { makeBackup, parseBackup, type BackupData } from './engine/backup'
import { DEVICE_KV, sameData, gzipB64, gunzipBytes, b64Bytes } from './engine/sync'
import * as store from './store/db'

export interface SyncConfig { repo: string; token: string; lastSync?: string; lastError?: string; lastPulled?: number }
export interface SyncResult { pulled: number; pushed: boolean }

const KEY = DEVICE_KV + 'sync'
const FILE = 'polyglot-sync.json.gz'
export const getSyncConfig = () => store.kvGet<SyncConfig>(KEY)
export const setSyncConfig = (c: SyncConfig | undefined) => (c ? store.kvSet(KEY, c) : store.db().then(d => d.delete('kv', KEY)))

class SyncError extends Error {}

async function api(c: SyncConfig, path: string, init: RequestInit & { accept?: string } = {}) {
  let r: Response
  try {
    r = await fetch(`https://api.github.com/repos/${c.repo}${path}`, {
      ...init, cache: 'no-store',
      headers: { Authorization: `Bearer ${c.token}`, Accept: init.accept ?? 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    })
  } catch { throw new SyncError('Offline or GitHub unreachable. Your progress is safe on this device; it will sync next time.') }
  if (r.status === 401) throw new SyncError('GitHub rejected the token (expired or mistyped). Paste a new one in Settings → Sync.')
  if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') throw new SyncError('GitHub rate limit hit; try again in an hour.')
  if (r.status === 403) throw new SyncError('The token can\'t write to this repo. Give it "Contents: Read and write" on that repo.')
  return r
}

async function pull(c: SyncConfig): Promise<{ data: BackupData | null; sha?: string }> {
  const r = await api(c, `/contents/${FILE}`)
  if (r.status === 404) {
    if ((await api(c, '')).status === 404) throw new SyncError(`Repo "${c.repo}" not found, or the token can't see it.`)
    return { data: null }
  }
  if (!r.ok) throw new SyncError(`GitHub error ${r.status}.`)
  const j = await r.json()
  // files over 1 MB come back without content; fetch the raw bytes instead
  const bytes = j.content ? b64Bytes(j.content) : new Uint8Array(await (await api(c, `/contents/${FILE}`, { accept: 'application/vnd.github.raw+json' })).arrayBuffer())
  return { data: parseBackup(await gunzipBytes(bytes)), sha: j.sha }
}

async function push(c: SyncConfig, d: BackupData, sha?: string): Promise<boolean> {
  const body = JSON.stringify({ message: `sync ${new Date().toISOString()}`, content: await gzipB64(makeBackup(d)), ...(sha ? { sha } : {}) })
  const r = await api(c, `/contents/${FILE}`, { method: 'PUT', body })
  if (r.status === 409 || r.status === 422) return false // another device pushed in between: pull again
  if (!r.ok) throw new SyncError(`GitHub error ${r.status} while saving.`)
  return true
}

async function run(c: SyncConfig): Promise<SyncResult> {
  let pulled = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await pull(c)
    if (remote.data) pulled += await store.mergeIn(remote.data)
    const local = await store.collectBackup(false, false)
    if (remote.data && sameData(local, remote.data)) return { pulled, pushed: false }
    if (await push(c, local, remote.sha)) return { pulled, pushed: true }
  }
  throw new SyncError('Another device kept syncing at the same moment; try again.')
}

let running: Promise<SyncResult | null> | null = null
/** Pull, merge, push. Safe to call often: concurrent calls share one run. Resolves null when sync isn't set up. */
export function syncNow(): Promise<SyncResult | null> {
  running ??= (async () => {
    const c = await getSyncConfig()
    if (!c?.token || !c.repo) return null
    try {
      const res = await run(c)
      await setSyncConfig({ ...c, lastSync: new Date().toISOString(), lastError: undefined, lastPulled: res.pulled })
      return res
    } catch (e) {
      await setSyncConfig({ ...c, lastError: e instanceof SyncError ? e.message : `Sync failed: ${(e as Error).message}` })
      throw e
    }
  })().finally(() => { running = null })
  return running
}
