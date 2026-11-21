import { it, expect, describe } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPack, loadIndex } from '../src/packs/loader'
import { textCoverage, parseFrequency, corpusCoverage } from '../src/engine/coverage'
import type { Pack } from '../src/packs/types'

const root = join(__dirname, '..', 'public', 'packs')
const fsFetch = (p: string) => readFile(join(root, p.replace(/^\/?packs\//, '')), 'utf8')

async function packs(): Promise<Pack[]> {
  const { index, concepts } = await loadIndex('', fsFetch)
  return Promise.all(index.filter(e => e.status === 'available').map(e => loadPack(e.path!, { fetchText: fsFetch, concepts })))
}

describe('pack content', async () => {
  for (const pack of await packs()) {
    const all = pack.words.map(w => w.id)

    it(`${pack.id}: every example sentence contains its word`, () => {
      const missing = pack.words.filter(w => textCoverage(pack, { lines: [w.ex] }, [w.id]).known === 0).map(w => w.id)
      expect(missing).toEqual([])
    })

    it(`${pack.id}: graded texts are readable with the pack vocabulary (≥85%), authentic texts ≥70%`, () => {
      const report = pack.texts.map(t => { const c = textCoverage(pack, t, all); return { id: t.id, kind: t.kind, pct: Math.round(c.ratio * 100), unknown: c.unknown } })
      if (process.env.REPORT) console.log(pack.id, JSON.stringify({ words: pack.words.length, grammar: pack.grammar.length, texts: pack.texts.length, report: report.filter(r => r.pct < 98) }))
      for (const r of report) expect(r.pct, `${r.id} unknown: ${r.unknown.join(' ')}`).toBeGreaterThanOrEqual(r.kind === 'authentic' ? 70 : 85)
    })

    it(`${pack.id}: every unit item is taught exactly once`, () => {
      const refs = pack.units.flatMap(u => u.items)
      expect(refs.length).toBe(new Set(refs).size)
      const taught = new Set(refs)
      const untaughtWords = pack.words.filter(w => !taught.has('word:' + w.id)).map(w => w.id)
      expect(untaughtWords).toEqual([])
    })

    if (pack.frequency) it(`${pack.id}: corpus coverage estimate is sane and fast`, async () => {
      const freq = parseFrequency(await fsFetch(`${pack.id}/${pack.frequency!.file}`))
      const t0 = performance.now()
      const cov = corpusCoverage(pack, freq, all)
      expect(cov).toBeGreaterThan(0.1)
      expect(cov).toBeLessThan(0.95)
      expect(performance.now() - t0).toBeLessThan(3000)
    })
  }
})
