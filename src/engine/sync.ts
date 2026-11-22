// Pure merge rules for cross-device sync. Nothing is ever deleted by a merge: the union of both sides wins.
import type { BackupData, CardRow, LogRow, EventRow, FlagRow } from './backup'

/** kv keys starting with this stay on the device: never synced, never in backup files (holds the sync token). */
export const DEVICE_KV = 'device:'

const t = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0)
export const logKey = (l: LogRow) => `${l.cardId}|${t(l.at)}`
export const eventKey = (e: EventRow) => `${e.lang}|${e.type}|${t(e.at)}|${e.seconds}`
export const flagKey = (f: FlagRow) => `${f.ref}|${t(f.at)}`

/** The card version to keep: the one reviewed most recently; ties go to more reps, then to `a`. */
export function newerCard(a: CardRow, b: CardRow): CardRow {
  const ta = t(a.srs.lastReviewAt), tb = t(b.srs.lastReviewAt)
  if (ta !== tb) return ta > tb ? a : b
  return b.srs.reps > a.srs.reps ? b : a
}

/** Merge two kv values for the same key. Settings: last write wins (updatedAt). Progress: union / max. */
export function mergeKv(key: string, a: any, b: any): any {
  if (a === undefined) return b
  if (b === undefined) return a
  if (key === 'settings') return (b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a
  if (key.startsWith('progress:')) {
    const max = (x: Record<string, number> = {}, y: Record<string, number> = {}) => {
      const o = { ...x }; for (const k in y) o[k] = Math.max(o[k] ?? 0, y[k]); return o
    }
    const hvpt = { ...(a.hvpt ?? {}) }
    for (const k in b.hvpt ?? {}) if ((b.hvpt[k]?.length ?? 0) > (hvpt[k]?.length ?? 0)) hvpt[k] = b.hvpt[k]
    return {
      ...a, ...b,
      introduced: [...new Set([...(a.introduced ?? []), ...(b.introduced ?? [])])],
      textReads: max(a.textReads, b.textReads), shadowed: max(a.shadowed, b.shadowed), hvpt,
    }
  }
  return a
}

function union<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const m = new Map<string, T>()
  for (const x of [...a, ...b]) if (!m.has(key(x))) m.set(key(x), x)
  return [...m.values()]
}

/** Merge two devices' data. Ids of logs/events/flags are device-local, so they are dropped and keyed by content. */
export function mergeData(a: BackupData, b: BackupData): BackupData {
  const cards = new Map<string, CardRow>()
  for (const c of [...a.cards, ...b.cards]) { const o = cards.get(c.id); cards.set(c.id, o ? newerCard(o, c) : c) }
  const kvA = new Map(a.kv.filter(([k]) => !k.startsWith(DEVICE_KV)))
  const kvB = new Map(b.kv.filter(([k]) => !k.startsWith(DEVICE_KV)))
  return canonicalize({
    cards: [...cards.values()],
    logs: union(a.logs, b.logs, logKey),
    events: union(a.events, b.events, eventKey),
    flags: union(a.flags, b.flags, flagKey),
    kv: [...new Set([...kvA.keys(), ...kvB.keys()])].map(k => [k, mergeKv(k, kvA.get(k), kvB.get(k))] as [string, unknown]),
    recordings: [],
  })
}

/** Stable order and no device-local ids, so two equal datasets serialise identically. */
export function canonicalize(d: BackupData): BackupData {
  const by = <T>(f: (x: T) => string) => (x: T, y: T) => (f(x) < f(y) ? -1 : f(x) > f(y) ? 1 : 0)
  const strip = <T extends { id?: number }>({ id, ...x }: T) => x as T
  return {
    cards: [...d.cards].sort(by(c => c.id)),
    logs: d.logs.map(strip).sort(by(logKey)),
    events: d.events.map(strip).sort(by(eventKey)),
    flags: d.flags.map(strip).sort(by(flagKey)),
    kv: d.kv.filter(([k]) => !k.startsWith(DEVICE_KV)).sort(by(([k]) => k)),
    recordings: [],
  }
}

export const sameData = (a: BackupData, b: BackupData) => JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))

// ---- transport encoding: gzip + base64 (GitHub's contents API wants base64) ----
async function pipe(bytes: Uint8Array, s: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(s)).arrayBuffer())
}
export async function gzipB64(text: string): Promise<string> {
  const z = await pipe(new TextEncoder().encode(text), new CompressionStream('gzip'))
  let s = ''
  for (let i = 0; i < z.length; i += 0x8000) s += String.fromCharCode(...z.subarray(i, i + 0x8000))
  return btoa(s)
}
export async function gunzipBytes(z: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await pipe(z, new DecompressionStream('gzip')))
}
export const b64Bytes = (b64: string) => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0))
