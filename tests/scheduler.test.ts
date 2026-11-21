import { describe, it, expect } from 'vitest'
import { getScheduler, newSrs, reviewSrs, retrievability, isMature, isDue, reviveSrs, previewSrs, State } from '../src/engine/scheduler'

const t0 = new Date('2026-01-01T09:00:00Z')

describe('scheduler', () => {
  it('new card is due immediately and has zero retrievability', async () => {
    const s = await getScheduler(0.9)
    const c = newSrs(s, t0)
    expect(c.state).toBe(State.New)
    expect(isDue(c, t0)).toBe(true)
    expect(retrievability(s, c, t0)).toBe(0)
  })

  it('first Good keeps a short learning step (minutes, not days)', async () => {
    const s = await getScheduler(0.9)
    const c = reviewSrs(s, newSrs(s, t0), 3, t0)
    const mins = (+c.dueAt - +t0) / 60000
    expect(mins).toBeLessThan(60)
  })

  it('repeated Good grows intervals and eventually matures', async () => {
    const s = await getScheduler(0.9)
    let c = newSrs(s, t0)
    let now = t0
    const gaps: number[] = []
    for (let i = 0; i < 8; i++) {
      c = reviewSrs(s, c, 3, now)
      gaps.push(+c.dueAt - +now)
      now = c.dueAt
    }
    for (let i = 3; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
    expect(isMature(c)).toBe(true)
  })

  it('Again on a review card lapses and relearns within minutes', async () => {
    const s = await getScheduler(0.9)
    let c = newSrs(s, t0)
    let now = t0
    for (let i = 0; i < 5; i++) { c = reviewSrs(s, c, 3, now); now = c.dueAt }
    const lapsed = reviewSrs(s, c, 1, now)
    expect(lapsed.lapses).toBe(c.lapses + 1)
    expect(lapsed.state).toBe(State.Relearning)
    expect((+lapsed.dueAt - +now) / 60000).toBeLessThan(60)
  })

  it('retrievability at the due date is close to the desired retention', async () => {
    const s = await getScheduler(0.9)
    let c = newSrs(s, t0)
    let now = t0
    for (let i = 0; i < 5; i++) { c = reviewSrs(s, c, 3, now); now = c.dueAt }
    expect(retrievability(s, c, c.dueAt)).toBeGreaterThan(0.85)
    expect(retrievability(s, c, c.dueAt)).toBeLessThan(0.95)
  })

  it('lower desired retention gives longer intervals (maintenance mode)', async () => {
    const hi = await getScheduler(0.9), lo = await getScheduler(0.8)
    let a = newSrs(hi, t0), b = newSrs(lo, t0), na = t0, nb = t0
    for (let i = 0; i < 5; i++) { a = reviewSrs(hi, a, 3, na); na = a.dueAt; b = reviewSrs(lo, b, 3, nb); nb = b.dueAt }
    expect(+nb - +t0).toBeGreaterThan(+na - +t0)
  })

  it('preview returns a due date per grade, Again earliest', async () => {
    const s = await getScheduler(0.9)
    const p = previewSrs(s, newSrs(s, t0), t0)
    expect(+p[1]).toBeLessThanOrEqual(+p[3])
    expect(+p[3]).toBeLessThanOrEqual(+p[4])
  })

  it('survives a JSON round trip (backup)', async () => {
    const s = await getScheduler(0.9)
    const c = reviewSrs(s, newSrs(s, t0), 3, t0)
    const back = reviveSrs(JSON.parse(JSON.stringify(c)))
    const next = reviewSrs(s, back, 3, back.dueAt)
    expect(next.reps).toBe(c.reps + 1)
  })
})
