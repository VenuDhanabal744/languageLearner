import { openDB, type IDBPDatabase } from 'idb'
import type { CardRow, EventRow, FlagRow, LogRow, RecordingRow, BackupData } from '../engine/backup'
import { DEVICE_KV, newerCard, mergeKv, logKey, eventKey, flagKey } from '../engine/sync'

let dbp: Promise<IDBPDatabase> | null = null
export function db() {
  dbp ??= openDB('polyglot', 1, {
    upgrade(d) {
      d.createObjectStore('cards', { keyPath: 'id' }).createIndex('lang', 'lang')
      d.createObjectStore('logs', { keyPath: 'id', autoIncrement: true }).createIndex('lang', 'lang')
      d.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('lang', 'lang')
      d.createObjectStore('flags', { keyPath: 'id', autoIncrement: true })
      d.createObjectStore('kv')
      d.createObjectStore('recordings', { keyPath: 'id' }).createIndex('ref', 'ref')
    },
  })
  return dbp
}

export const getAllCards = async (lang?: string): Promise<CardRow[]> => lang ? (await db()).getAllFromIndex('cards', 'lang', lang) : (await db()).getAll('cards')
export const getCard = async (id: string): Promise<CardRow | undefined> => (await db()).get('cards', id)
export const putCard = async (c: CardRow) => (await db()).put('cards', c)
export async function putCards(cs: CardRow[]) {
  const tx = (await db()).transaction('cards', 'readwrite')
  for (const c of cs) tx.store.put(c)
  await tx.done
}
export const addLog = async (l: LogRow) => (await db()).add('logs', l)
export const getLogs = async (): Promise<LogRow[]> => (await db()).getAll('logs')
export const addEvent = async (e: EventRow) => (await db()).add('events', e)
export const getEvents = async (): Promise<EventRow[]> => (await db()).getAll('events')
export const addFlag = async (f: FlagRow) => (await db()).add('flags', f)
export const getFlags = async (): Promise<FlagRow[]> => (await db()).getAll('flags')
export const deleteFlag = async (id: number) => (await db()).delete('flags', id)
export const kvGet = async <T>(k: string): Promise<T | undefined> => (await db()).get('kv', k)
export const kvSet = async (k: string, v: unknown) => (await db()).put('kv', v, k)

export const putRecording = async (r: RecordingRow) => (await db()).put('recordings', r)
export const getRecordingsByRef = async (ref: string): Promise<RecordingRow[]> => (await db()).getAllFromIndex('recordings', 'ref', ref)
export const getAllRecordings = async (): Promise<RecordingRow[]> => (await db()).getAll('recordings')
export const deleteRecording = async (id: string) => (await db()).delete('recordings', id)

async function blobToB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return new Blob([out], { type: mime })
}

/** Gather everything for a backup. Speaker recordings (for HVPT) are always kept; shadowing attempts only if asked. */
export async function collectBackup(includeShadowing: boolean, recordings = true): Promise<BackupData> {
  const d = await db()
  const kvKeys = ((await d.getAllKeys('kv')) as string[]).filter(k => !k.startsWith(DEVICE_KV)) // the sync token stays on the device
  const kv: [string, unknown][] = await Promise.all(kvKeys.map(async k => [k, await d.get('kv', k)] as [string, unknown]))
  const recs = recordings ? (await getAllRecordings()).filter(r => r.talker || includeShadowing) : []
  return {
    cards: await getAllCards(), logs: await getLogs(), events: await getEvents(), flags: await getFlags(), kv,
    recordings: await Promise.all(recs.map(async ({ blob, ...meta }) => ({ ...meta, b64: await blobToB64(blob) }))),
  }
}

/** Replace all local data with a backup. Single transaction so a failure leaves the old data intact. */
export async function restoreBackup(b: BackupData) {
  const d = await db()
  const stores = ['cards', 'logs', 'events', 'flags', 'kv', 'recordings'] as const
  const tx = d.transaction(stores as unknown as string[], 'readwrite')
  for (const s of stores) if (s !== 'kv') tx.objectStore(s).clear()
  for (const k of (await tx.objectStore('kv').getAllKeys()) as string[]) if (!k.startsWith(DEVICE_KV)) tx.objectStore('kv').delete(k)
  for (const c of b.cards) tx.objectStore('cards').put(c)
  for (const l of b.logs) tx.objectStore('logs').put(l)
  for (const e of b.events) tx.objectStore('events').put(e)
  for (const f of b.flags) tx.objectStore('flags').put(f)
  for (const [k, v] of b.kv) tx.objectStore('kv').put(v, k)
  for (const { b64, ...r } of b.recordings) tx.objectStore('recordings').put({ ...r, blob: b64ToBlob(b64, r.mime) })
  await tx.done
}

/** Merge another device's data into this one, in one transaction, re-checking against what is stored right now
 *  so a review made while the network call was in flight is never overwritten. Returns how many things changed. */
export async function mergeIn(b: BackupData): Promise<number> {
  const tx = (await db()).transaction(['cards', 'logs', 'events', 'flags', 'kv'], 'readwrite')
  let n = 0
  const cards = tx.objectStore('cards')
  for (const c of b.cards) {
    const cur = await cards.get(c.id) as CardRow | undefined
    if (!cur || (newerCard(cur, c) === c && JSON.stringify(cur.srs) !== JSON.stringify(c.srs))) { await cards.put(c); n++ }
  }
  const addMissing = async <T extends { id?: number }>(store: 'logs' | 'events' | 'flags', rows: T[], key: (x: T) => string) => {
    const have = new Set(((await tx.objectStore(store).getAll()) as T[]).map(key))
    for (const { id, ...r } of rows) if (!have.has(key(r as T))) { await tx.objectStore(store).add(r); have.add(key(r as T)); n++ }
  }
  await addMissing('logs', b.logs, logKey)
  await addMissing('events', b.events, eventKey)
  await addMissing('flags', b.flags, flagKey)
  const kv = tx.objectStore('kv')
  for (const [k, v] of b.kv) {
    if (k.startsWith(DEVICE_KV)) continue
    const cur = await kv.get(k)
    const m = mergeKv(k, cur, v)
    if (JSON.stringify(m) !== JSON.stringify(cur)) { await kv.put(m, k); n++ }
  }
  await tx.done
  return n
}
