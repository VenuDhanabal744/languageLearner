import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPack, loadIndex } from '../src/packs/loader'
import { textCoverage, parseFrequency, corpusCoverage } from '../src/engine/coverage'

const root = join(__dirname, '..', 'public', 'packs')
const fsFetch = (p: string) => readFile(join(root, p.replace(/^\/?packs\//, '')), 'utf8')

it('Arabic texts are readable with the pack vocabulary (≥85% coverage once all words are learned)', async () => {
  const { concepts } = await loadIndex('', fsFetch)
  const pack = await loadPack('ar', { fetchText: fsFetch, concepts })
  const all = pack.words.map(w => w.id)
  const report = pack.texts.map(t => { const c = textCoverage(pack, t, all); return { id: t.id, pct: Math.round(c.ratio * 100), unknown: c.unknown } })
  if (process.env.REPORT) console.log(JSON.stringify({ words: pack.words.length, grammar: pack.grammar.length, texts: pack.texts.length, report }, null, 1))
  for (const r of report) expect(r.pct, `${r.id} unknown: ${r.unknown.join(' ')}`).toBeGreaterThanOrEqual(85)
  const freq = parseFrequency(await fsFetch('ar/frequency.txt'))
  const cov = corpusCoverage(pack, freq, all)
  if (process.env.REPORT) console.log('estimated corpus coverage with all words:', cov)
  expect(cov).toBeGreaterThan(0.1)
  const t0 = performance.now(); corpusCoverage(pack, freq, all.slice(0, 20)); expect(performance.now() - t0).toBeLessThan(1500)
})
