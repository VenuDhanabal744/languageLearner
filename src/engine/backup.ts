import { reviveSrs, type SrsState } from './scheduler'

export const BACKUP_FORMAT = 'polyglot-backup'
export const BACKUP_VERSION = 1

export interface CardRow { id: string; lang: string; kind: string; ref: string; srs: SrsState; created: Date; extra?: Record<string, string> }
export interface LogRow { id?: number; cardId: string; lang: string; kind: string; grade: number; at: Date; prevState: number; prevStability: number }
export interface EventRow { id?: number; lang: string; type: 'speak' | 'listen' | 'read' | 'hvpt' | 'study'; seconds: number; at: Date; ref?: string; score?: number }
export interface FlagRow { id?: number; lang: string; ref: string; note: string; at: Date; text?: string }
export interface RecordingRow { id: string; lang: string; ref: string; talker?: string; mime: string; at: Date; durationSec: number; blob: Blob }

export interface BackupData {
  cards: CardRow[]
  logs: LogRow[]
  events: EventRow[]
  flags: FlagRow[]
  kv: [string, unknown][]
  recordings: (Omit<RecordingRow, 'blob'> & { b64: string })[]
}

export function makeBackup(data: BackupData, now = new Date()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data })
}

const d = (x: unknown) => new Date(x as string)

/** Validates and revives a backup file. Throws a readable Error on anything unexpected. */
export function parseBackup(text: string): BackupData {
  let j: any
  try { j = JSON.parse(text) } catch { throw new Error('This file is not valid JSON.') }
  if (j?.format !== BACKUP_FORMAT) throw new Error('This is not a backup from this app.')
  if (typeof j.version !== 'number' || j.version > BACKUP_VERSION) throw new Error(`Backup version ${j.version} is newer than this app understands.`)
  const x = j.data ?? {}
  for (const k of ['cards', 'logs', 'events', 'flags', 'kv']) if (!Array.isArray(x[k])) throw new Error(`Backup is missing "${k}".`)
  for (const c of x.cards) if (typeof c?.id !== 'string' || !c.srs) throw new Error('Backup has a malformed card.')
  return {
    cards: x.cards.map((c: any) => ({ ...c, srs: reviveSrs(c.srs), created: d(c.created) })),
    logs: x.logs.map((l: any) => ({ ...l, at: d(l.at) })),
    events: x.events.map((e: any) => ({ ...e, at: d(e.at) })),
    flags: x.flags.map((f: any) => ({ ...f, at: d(f.at) })),
    kv: x.kv,
    recordings: (x.recordings ?? []).map((r: any) => ({ ...r, at: d(r.at) })),
  }
}

export function backupFileName(now = new Date()) {
  return `polyglot-backup-${now.toISOString().slice(0, 10)}.json`
}
