import { describe, it, expect } from 'vitest'
import { buildConversationPrompt, parseMistakes } from '../src/engine/conversation'
import { makeBackup, parseBackup } from '../src/engine/backup'
import { buildDailyIcs } from '../src/engine/ics'
import { computeMetrics } from '../src/engine/metrics'
import { getScheduler, newSrs, reviewSrs, State } from '../src/engine/scheduler'

describe('conversation round trip', () => {
  it('prompt contains level, vocab, grammar, scenario and the MISTAKES contract', () => {
    const p = buildConversationPrompt({
      language: 'Levantine Arabic', level: 'Unit 2', showTranslit: true,
      knownWords: [{ text: 'مَرحَبا', tr: 'marḥaba', en: 'hello' }], grammar: ['bidd- (want)'],
      scenario: { title: 'Café', setup: 'Ordering coffee.', you: 'customer', partner: 'waiter' },
    })
    for (const s of ['Unit 2', 'مَرحَبا', 'bidd-', 'waiter', 'MISTAKES', 'said | correct | note', 'END']) expect(p).toContain(s)
  })

  it('parses the plain block, skipping the header', () => {
    const m = parseMistakes('MISTAKES\nsaid | correct | note\nأنا بدي قهوة | بدّي قهوة | drop أنا is fine; stress\nهو كتبت | هو كتب | 3rd person past')
    expect(m).toHaveLength(2)
    expect(m[1]).toEqual({ said: 'هو كتبت', correct: 'هو كتب', note: '3rd person past' })
  })

  it('parses markdown tables and bullets with surrounding chatter', () => {
    const m = parseMistakes('Sure! Here:\n\nMISTAKES\n| said | correct | note |\n|---|---|---|\n| انا رحت | رحت | pronoun optional |\n- x | y | z\n\nGood luck!')
    expect(m.map(x => x.correct)).toEqual(['رحت', 'y'])
  })

  it('returns nothing for text without pipes', () => {
    expect(parseMistakes('no mistakes, well done')).toEqual([])
  })
})

describe('backup', () => {
  it('round-trips cards with dates intact', async () => {
    const s = await getScheduler(0.9)
    const srs = reviewSrs(s, newSrs(s, new Date('2026-01-01')), 3, new Date('2026-01-01'))
    const data = {
      cards: [{ id: 'ar:produce:w1', lang: 'ar', kind: 'produce', ref: 'w1', srs, created: new Date('2026-01-01') }],
      logs: [{ cardId: 'ar:produce:w1', lang: 'ar', kind: 'produce', grade: 3, at: new Date('2026-01-01'), prevState: 0, prevStability: 0 }],
      events: [], flags: [], kv: [['settings', { harakat: true }]] as [string, unknown][], recordings: [],
    }
    const back = parseBackup(makeBackup(data))
    expect(back.cards[0].srs.dueAt).toBeInstanceOf(Date)
    expect(+back.cards[0].srs.dueAt).toBe(+srs.dueAt)
    expect(back.logs[0].at).toBeInstanceOf(Date)
    expect(back.kv).toEqual(data.kv)
  })

  it('rejects foreign or corrupt files with a readable message', () => {
    expect(() => parseBackup('nope')).toThrow(/not valid JSON/)
    expect(() => parseBackup('{"format":"other"}')).toThrow(/not a backup/)
    expect(() => parseBackup('{"format":"polyglot-backup","version":99,"data":{}}')).toThrow(/newer/)
    expect(() => parseBackup('{"format":"polyglot-backup","version":1,"data":{"cards":[]}}')).toThrow(/missing/)
  })
})

describe('ics reminder', () => {
  it('is a daily recurring event at the chosen local time', () => {
    const ics = buildDailyIcs({ hour: 20, minute: 5, url: 'https://x.test/', start: new Date(2026, 10, 21) })
    expect(ics).toContain('DTSTART:20261121T200500')
    expect(ics).toContain('RRULE:FREQ=DAILY')
    expect(ics.split('\r\n').length).toBeGreaterThan(10)
  })
})

describe('metrics', () => {
  it('counts true retention only on graduated cards, and speaking minutes', () => {
    const now = new Date('2026-02-01T12:00:00Z')
    const logs = [
      { cardId: 'a', lang: 'ar', kind: 'produce', grade: 3, at: now, prevState: State.Review, prevStability: 30 },
      { cardId: 'b', lang: 'ar', kind: 'produce', grade: 1, at: now, prevState: State.Review, prevStability: 30 },
      { cardId: 'c', lang: 'ar', kind: 'produce', grade: 1, at: now, prevState: State.Learning, prevStability: 0 },
    ]
    const events = [{ lang: 'ar', type: 'speak' as const, seconds: 90, at: now }]
    const m = computeMetrics([], logs, events, now)
    expect(m.retention30).toBe(0.5)
    expect(m.speakMin7).toBeCloseTo(1.5)
    expect(m.daily).toHaveLength(14)
  })
})

describe('broken-voice detection', async () => {
  const { playedTooFast } = await import('../src/audio/tts')
  it('flags Hebrew that "played" in half a second (Chrome on Mac + Carmit)', () => {
    expect(playedTooFast('שָׁלוֹם, אֲנִי וֶנוּ.', 0.5)).toBe(true)
    expect(playedTooFast('שלום, שמי ונו ואני גר בבולטימור.', 0.52)).toBe(true)
  })
  it('accepts real speech timings measured on the same Mac', () => {
    expect(playedTooFast('שלום, שמי ונו ואני גר בבולטימור.', 2.38)).toBe(false)
    expect(playedTooFast('Hi, I am Venu.', 1.63)).toBe(false)
    expect(playedTooFast('مرحبا، اسمي فينو.', 2.5)).toBe(false)
    expect(playedTooFast('Ciao, mi chiamo Venu.', 2.24)).toBe(false)
  })
  it('ignores single words and failed playback', () => {
    expect(playedTooFast('שָׁלוֹם', 0.3)).toBe(false)
    expect(playedTooFast('שלום, שמי ונו ואני גר', 0)).toBe(false)
  })
})
