// On-device speech synthesis. iOS requires speak() to start from a tap.
let voicesCache: SpeechSynthesisVoice[] = []
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([])
  const now = speechSynthesis.getVoices()
  if (now.length) { voicesCache = now; return Promise.resolve(now) }
  return new Promise(res => {
    const done = () => { voicesCache = speechSynthesis.getVoices(); res(voicesCache) }
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500) // iOS home-screen apps sometimes never fire voiceschanged
  })
}

export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  const v = voicesCache.length ? voicesCache : ttsSupported() ? speechSynthesis.getVoices() : []
  return v.filter(x => x.lang.toLowerCase().replace('_', '-').startsWith(lang.toLowerCase()))
}

export interface SpeakOpts { rate?: number; pitch?: number; voice?: SpeechSynthesisVoice }

/** Speak and resolve with the seconds it took (for listening-minute metrics). */
export function speak(text: string, lang: string, o: SpeakOpts = {}): Promise<number> {
  if (!ttsSupported()) return Promise.resolve(0)
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = o.voice?.lang ?? lang
  const v = o.voice ?? voicesFor(lang)[0]
  if (v) u.voice = v
  u.rate = o.rate ?? 0.9
  u.pitch = o.pitch ?? 1
  const t0 = performance.now()
  return new Promise(res => {
    let done = false
    const end = () => { if (!done) { done = true; clearTimeout(guard); res((performance.now() - t0) / 1000) } }
    // iOS sometimes never fires onend; don't let the UI hang on it
    const guard = setTimeout(end, 2000 + text.length * 180 / (u.rate || 1))
    u.onend = end
    u.onerror = () => { if (!done) { done = true; clearTimeout(guard); res(0) } }
    speechSynthesis.speak(u)
  })
}

/** True when playback ended too fast to have read the text: some browser/voice pairs (Chrome on Mac + Carmit)
 *  "speak" Hebrew in ~0.5 s whatever its length. Real Carmit speech measured ~11 letters/s (unvowelled Hebrew is dense), so flag above ~16. */
export function playedTooFast(text: string, seconds: number, rate = 0.9): boolean {
  const letters = (text.match(/\p{L}/gu) ?? []).length
  return letters >= 8 && seconds > 0 && seconds < letters * 0.06 / rate
}
