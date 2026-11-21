import type { Pack, Concept } from './types'

const ARRAYS = ['units', 'words', 'grammar', 'texts', 'scriptLessons', 'contrasts', 'speaking', 'scenarios'] as const

/** Returns human-readable problems; empty array = valid. Run by tests and at load time. */
export function validatePack(p: any, concepts?: Concept[]): string[] {
  const errs: string[] = []
  const need = (cond: unknown, msg: string) => { if (!cond) errs.push(msg) }
  if (!p || typeof p !== 'object') return ['pack is not an object']
  for (const k of ['id', 'name', 'version', 'tts']) need(typeof p[k] === 'string' && p[k], `missing string "${k}"`)
  need(p.dir === 'rtl' || p.dir === 'ltr', '"dir" must be "rtl" or "ltr"')
  need(p.translit && typeof p.translit.name === 'string', 'missing translit.name')
  for (const k of ARRAYS) need(Array.isArray(p[k]), `"${k}" must be an array`)
  if (errs.length) return errs

  for (const rx of [p.vowelToggle?.strip, p.normalize?.strip].filter(Boolean)) {
    try { new RegExp(`[${rx}]`, 'u') } catch { errs.push(`invalid character class: ${rx}`) }
  }

  const ids = new Map<string, Set<string>>()
  const uniq = (kind: string, id: unknown, where: string) => {
    if (typeof id !== 'string' || !id) { errs.push(`${where}: missing id`); return }
    const s = ids.get(kind) ?? ids.set(kind, new Set()).get(kind)!
    if (s.has(id)) errs.push(`${where}: duplicate ${kind} id "${id}"`)
    s.add(id)
  }
  const ex = (e: any, where: string) => need(e && typeof e.text === 'string' && e.text && typeof e.en === 'string', `${where}: example needs text + en`)

  p.words.forEach((w: any, i: number) => {
    const at = `words[${i}] ${w?.id ?? ''}`
    uniq('word', w?.id, at)
    need(w.text && w.tr && w.en, `${at}: needs text, tr, en`)
    ex(w.ex, at)
    need(typeof w.verified === 'boolean', `${at}: needs verified true/false`)
  })
  p.grammar.forEach((g: any, i: number) => {
    const at = `grammar[${i}] ${g?.id ?? ''}`
    uniq('grammar', g?.id, at)
    need(g.title && Array.isArray(g.body) && g.body.length, `${at}: needs title and body[]`)
    need(Array.isArray(g.examples), `${at}: needs examples[]`)
    ;(g.examples ?? []).forEach((e: any, j: number) => ex(e, `${at} examples[${j}]`))
    need(Array.isArray(g.drills), `${at}: needs drills[]`)
    ;(g.drills ?? []).forEach((d: any, j: number) => { uniq('drill', d?.id, `${at} drills[${j}]`); need(d.prompt && d.answer, `${at} drills[${j}]: needs prompt + answer`) })
    if (g.concept && concepts) need(concepts.some(c => c.id === g.concept), `${at}: unknown concept "${g.concept}"`)
    need(typeof g.verified === 'boolean', `${at}: needs verified`)
  })
  p.texts.forEach((t: any, i: number) => {
    const at = `texts[${i}] ${t?.id ?? ''}`
    uniq('text', t?.id, at)
    need(['dialogue', 'reading', 'authentic'].includes(t.kind), `${at}: bad kind`)
    need(Array.isArray(t.lines) && t.lines.length, `${at}: needs lines[]`)
    ;(t.lines ?? []).forEach((l: any, j: number) => ex(l, `${at} lines[${j}]`))
    need(typeof t.verified === 'boolean', `${at}: needs verified`)
  })
  p.scriptLessons.forEach((s: any, i: number) => {
    const at = `scriptLessons[${i}] ${s?.id ?? ''}`
    uniq('script', s?.id, at)
    ;(s.letters ?? []).forEach((l: any, j: number) => { uniq('letter', l?.id, `${at} letters[${j}]`); need(l.char && l.name && l.sound, `${at} letters[${j}]: needs char, name, sound`); ex(l.ex, `${at} letters[${j}]`) })
  })
  p.contrasts.forEach((c: any, i: number) => {
    const at = `contrasts[${i}] ${c?.id ?? ''}`
    uniq('contrast', c?.id, at)
    const sides = new Set((c.items ?? []).map((x: any) => x.side))
    need(sides.has('a') && sides.has('b'), `${at}: needs items on both sides a and b`)
    ;(c.items ?? []).forEach((x: any, j: number) => uniq('contrastItem', x?.id, `${at} items[${j}]`))
  })
  p.speaking.forEach((s: any, i: number) => { uniq('speaking', s?.id, `speaking[${i}]`); need(s.en, `speaking[${i}]: needs en`) })
  p.scenarios.forEach((s: any, i: number) => { uniq('scenario', s?.id, `scenarios[${i}]`); need(s.title && s.setup && s.you && s.partner, `scenarios[${i}]: needs title, setup, you, partner`) })

  const kindOf: Record<string, string> = { word: 'word', grammar: 'grammar', script: 'script', text: 'text' }
  p.units.forEach((u: any, i: number) => {
    const at = `units[${i}] ${u?.id ?? ''}`
    uniq('unit', u?.id, at)
    need(u.title && Array.isArray(u.items), `${at}: needs title + items[]`)
    for (const ref of u.items ?? []) {
      const [k, id] = String(ref).split(':')
      if (!kindOf[k]) errs.push(`${at}: bad ref "${ref}" (use word:/grammar:/script:/text:)`)
      else if (!ids.get(kindOf[k])?.has(id)) errs.push(`${at}: ref "${ref}" points to nothing`)
    }
  })
  return errs
}
