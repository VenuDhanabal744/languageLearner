import type { Pack, PackIndexEntry, Concept, CrossLink } from './types'
import { validatePack } from './validate'

export type FetchText = (path: string) => Promise<string>

const browserFetch: FetchText = async path => {
  const r = await fetch(path, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
  return r.text()
}

const ARRAYS = ['units', 'words', 'grammar', 'texts', 'scriptLessons', 'contrasts', 'speaking', 'scenarios', 'notes'] as const

/** Merge an include file into the pack: arrays are concatenated, nothing else may be overridden. */
export function mergeInclude(pack: any, inc: any, file: string) {
  for (const [k, v] of Object.entries(inc ?? {})) {
    if (!(ARRAYS as readonly string[]).includes(k)) throw new Error(`${file}: key "${k}" not allowed in an include (only ${ARRAYS.join(', ')})`)
    if (!Array.isArray(v)) throw new Error(`${file}: "${k}" must be an array`)
    pack[k] = [...(pack[k] ?? []), ...v]
  }
}

export async function loadPack(base: string, opts: { fetchText?: FetchText; concepts?: Concept[] } = {}): Promise<Pack> {
  const get = opts.fetchText ?? browserFetch
  const dir = base.endsWith('/') ? base : base + '/'
  const parse = (txt: string, file: string) => { try { return JSON.parse(txt) } catch (e) { throw new Error(`${file}: invalid JSON (${(e as Error).message})`) } }
  const pack = parse(await get(dir + 'pack.json'), 'pack.json')
  for (const k of ARRAYS) pack[k] ??= []
  for (const file of pack.includes ?? []) mergeInclude(pack, parse(await get(dir + file), file), file)
  const errs = validatePack(pack, opts.concepts)
  if (errs.length) throw new Error(`Pack "${pack.id ?? base}" has ${errs.length} problem(s):\n` + errs.slice(0, 20).join('\n'))
  return pack as Pack
}

export async function loadIndex(base: string, fetchText: FetchText = browserFetch) {
  const dir = base.endsWith('/') ? base : base + '/'
  const [index, concepts, links] = await Promise.all([
    fetchText(dir + 'index.json').then(JSON.parse) as Promise<PackIndexEntry[]>,
    fetchText(dir + 'shared/concepts.json').then(JSON.parse) as Promise<Concept[]>,
    fetchText(dir + 'shared/links.json').then(JSON.parse) as Promise<CrossLink[]>,
  ])
  return { index, concepts, links }
}
