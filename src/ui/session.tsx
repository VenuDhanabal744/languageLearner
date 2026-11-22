import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Activity } from '../engine/session'
import type { CardRow } from '../engine/backup'
import type { Pack, Text } from '../packs/types'
import {
  buildToday, grade, introduce, logEvent, parseRef, saveProgress, wordById, grammarById, scriptById, textById, drillById, letterById,
  showTranslit, learnedWordIds, type World,
} from '../logic'
import { getScheduler, previewSrs, formatInterval, type Grade } from '../engine/scheduler'
import { answerMatches, buildLexicon, lookup, tokenize, respell, stripVowels, normalize } from '../engine/text'
import { textCoverage } from '../engine/coverage'
import { speak, voicesFor } from '../audio/tts'
import { startRecording, playBlob, type ActiveRecording, type Recording } from '../audio/recorder'
import * as store from '../store/db'
import { T, Speak, Flag, RecordCompare, Screen, Rich, Why, useApp, useTimer } from './common'
import { WritePad, WriteLetter, WriteWord, VerdictLine, WordVerdict, checkLetter, checkWord, lettersOf, handwritingOn, warmTemplates, WORD_ASPECT, type Stroke } from './handwriting'
import type { WordResult } from '../engine/wordwriting'
import type { Verdict } from '../engine/handwriting'

const ACT_LABEL: Record<Activity['type'], string> = {
  review: 'Review (spaced retrieval)', learn: 'New material', shadow: 'Shadowing (speak)', read: 'Reading (input)',
  hvpt: 'Sound training', speak: 'Speaking prompt', fluency: '4/3/2 fluency',
}
const ACT_WHY: Record<Activity['type'], string> = {
  review: 'spaced-retrieval', learn: 'explicit-grammar', shadow: 'output', read: 'coverage', hvpt: 'hvpt', speak: 'output', fluency: 'fluency-432',
}

export function SessionScreen({ minutes }: { minutes: number }) {
  const { w, nav, refresh } = useApp()
  const [acts, setActs] = useState<Activity[] | null>(null)
  const [i, setI] = useState(-1)
  const [t] = useTimer(i >= 0 && acts !== null && i < acts.length)
  useEffect(() => { buildToday(w, minutes).then(setActs) }, [minutes])
  if (!acts) return <Screen title="Building your session…" back><p>…</p></Screen>
  const next = () => setI(x => x + 1)
  if (i < 0) {
    return (
      <Screen title={`${minutes}-minute session`} back>
        {acts.length === 0 && <p>Nothing to do: no languages active. Turn one on in Settings → Languages.</p>}
        <ol class="plan">
          {acts.map((a, k) => (
            <li key={k}><b>{ACT_LABEL[a.type]}</b> <span class="muted">· {w.packs[a.lang]?.name.split(':')[0]} · ~{Math.max(1, Math.round(a.minutes))} min</span>
              {a.type === 'review' && <span class="muted"> · {a.cardIds.length} cards</span>}
              {a.type === 'learn' && <span class="muted"> · {a.refs.length} items</span>}
              <Why id={ACT_WHY[a.type]} />
            </li>
          ))}
        </ol>
        {acts.length > 0 && <button class="btn primary big" onClick={() => setI(0)}>Start</button>}
      </Screen>
    )
  }
  if (i >= acts.length) {
    return (
      <Screen title="Done">
        <p>You practised for about <b>{Math.max(1, Math.round(t / 60))} minutes</b>. That's the whole session. Nothing else to keep up.</p>
        <button class="btn primary" onClick={() => { refresh(); nav({ name: 'today' }) }}>Back to Today</button>
      </Screen>
    )
  }
  const a = acts[i]
  const pack = w.packs[a.lang]
  return (
    <main class="screen">
      <header class="top">
        <button class="link" onClick={() => { refresh(); nav({ name: 'today' }) }}>End</button>
        <h1>{ACT_LABEL[a.type]}</h1>
        <span class="muted small">{i + 1}/{acts.length}</span>
      </header>
      <div key={i}>
        {a.type === 'review' && <ReviewRunner w={w} cardIds={a.cardIds} onDone={next} />}
        {a.type === 'learn' && <LearnRunner w={w} pack={pack} refs={a.refs} onDone={next} />}
        {a.type === 'shadow' && <ShadowRunner w={w} pack={pack} refs={a.refs} onDone={next} />}
        {a.type === 'read' && <ReadRunner w={w} pack={pack} textId={a.textId} onDone={next} />}
        {a.type === 'hvpt' && <HvptRunner w={w} pack={pack} contrastId={a.contrastId} onDone={next} />}
        {a.type === 'speak' && <SpeakRunner pack={pack} promptId={a.promptId} onDone={next} />}
        {a.type === 'fluency' && <FluencyRunner pack={pack} promptId={a.promptId} onDone={next} />}
      </div>
      <p class="center"><button class="link small" onClick={next}>Skip this part</button></p>
    </main>
  )
}

// ---------------- review ----------------
export function ReviewRunner({ w, cardIds, onDone, title }: { w: World; cardIds: string[]; onDone: () => void; title?: string }) {
  const [queue, setQueue] = useState<CardRow[] | null>(null)
  const [repeats] = useState(() => new Map<string, number>())
  useEffect(() => {
    Promise.all(cardIds.map(id => store.getCard(id))).then(cs => setQueue(cs.filter((c): c is CardRow => !!c)))
  }, [])
  useEffect(() => { if (queue && queue.length === 0) onDone() }, [queue])
  if (!queue || !queue.length) return <p>…</p>
  const card = queue[0]
  return (
    <div>
      {title && <p class="muted">{title}</p>}
      <p class="muted small">{queue.length} left</p>
      <CardView key={card.id + (repeats.get(card.id) ?? 0)} w={w} card={card} onGraded={next => {
        const rest = queue.slice(1)
        const r = repeats.get(card.id) ?? 0
        // relearning steps due within the session come back at the end (max twice)
        if (+next.srs.dueAt - Date.now() < 15 * 60000 && r < 2) { repeats.set(card.id, r + 1); rest.push(next) }
        setQueue(rest)
      }} />
    </div>
  )
}

function GradeButtons({ card, onGrade }: { card: CardRow; onGrade: (g: Grade) => void }) {
  const { w } = useApp()
  const [iv, setIv] = useState<Record<number, string>>({})
  useEffect(() => {
    getScheduler(w.settings.retention).then(s => {
      const now = new Date(), p = previewSrs(s, card.srs, now)
      setIv({ 1: formatInterval(now, p[1]), 2: formatInterval(now, p[2]), 3: formatInterval(now, p[3]), 4: formatInterval(now, p[4]) })
    })
  }, [card.id])
  const B = (g: Grade, label: string, cls: string) => <button class={`btn grade ${cls}`} onClick={() => onGrade(g)}>{label}<small>{iv[g] ?? ''}</small></button>
  return <div class="grades">{B(1, 'Again', 'again')}{B(2, 'Hard', 'hard')}{B(3, 'Good', 'good')}{B(4, 'Easy', 'easy')}</div>
}

function TypeBox({ pack, value, onInput }: { pack: Pack; value: string; onInput: (s: string) => void }) {
  return <input class="type" lang={pack.id} dir={pack.dir} autocapitalize="off" autocomplete="off" spellcheck={false}
    placeholder={handwritingOn() && pack.wordWriting === 'scribble' ? 'Say it aloud, then write it here with Apple Pencil or type it' : 'Say it aloud, then type it (optional)'} value={value} onInput={e => onInput((e.target as HTMLInputElement).value)} />
}

function CardView({ w, card, onGraded }: { w: World; card: CardRow; onGraded: (c: CardRow) => void }) {
  const pack = w.packs[card.lang]
  const prog = w.progress[card.lang]
  const [shown, setShown] = useState(false)
  const [typed, setTyped] = useState('')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [writing, setWriting] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [wordRes, setWordRes] = useState<WordResult | null | undefined>(undefined)
  if (!pack) return <p>Pack for {card.lang} isn't loaded.</p>
  const hw = handwritingOn()
  let writeTarget = ''
  if (hw && pack.wordWriting === 'segment') warmTemplates(pack)
  const wordPad = () => hw && !!expected && pack.wordWriting !== 'scribble' && (card.kind === 'produce' || card.kind === 'drill' || card.kind === 'mistake')
  const doGrade = async (g: Grade) => onGraded(await grade(w, card, g))
  let prompt: preact.ComponentChildren = null, answer: preact.ComponentChildren = null, audio = '', expected = '', flagRef = card.id

  if (card.kind === 'produce' || card.kind === 'listen' || card.kind === 'read') {
    const word = wordById(pack, card.ref)
    if (!word) return <Missing onSkip={() => onGraded(card)} />
    audio = word.ex.text; expected = word.text; flagRef = 'word:' + word.id
    answer = <>
      <p><T pack={pack} text={word.text} big /> <span class="tr">{word.tr}</span> · {word.en}</p>
      <p><T pack={pack} text={word.ex.text} /></p>
      <p class="tr">{word.ex.tr}</p><p class="muted">{word.ex.en}</p>
      {word.root && <p class="muted small">root {word.root}</p>}
      <Cognates c={word.cognates} />
    </>
    prompt = card.kind === 'read'
      ? <><p class="muted small">Read it aloud. What does it mean?</p><p><T pack={pack} text={word.ex.text} big /></p></>
      : card.kind === 'produce'
      ? <><p class="muted small">Say it in {pack.name.split(':')[0].split(' ')[0]}, out loud:</p><p class="big">{word.en}</p><p class="muted">in: “{word.ex.en}”</p></>
      : <><p class="muted small">Listen. What does it mean?</p><Speak pack={pack} text={word.ex.text} label="▶︎ Listen" /><Speak pack={pack} text={word.ex.text} label="🐢 Slow" rate={0.6} /></>
  } else if (card.kind === 'drill') {
    const x = drillById(pack, card.ref)
    if (!x) return <Missing onSkip={() => onGraded(card)} />
    audio = x.d.answer; expected = x.d.answer; flagRef = 'grammar:' + x.g.id
    prompt = <><p class="muted small">{x.g.title}</p><p class="big">{x.d.prompt}</p>{x.d.cue && <T pack={pack} text={x.d.cue} />}</>
    answer = <><p><T pack={pack} text={x.d.answer} big /></p>{x.d.tr && <p class="tr">{x.d.tr}</p>}</>
  } else if (card.kind === 'script') {
    const x = letterById(pack, card.ref)
    if (!x) return <Missing onSkip={() => onGraded(card)} />
    audio = x.l.ex.text; flagRef = 'script:' + x.s.id
    const forms = letterForms(x.l.char, x.l.connects)
    const f = forms[card.srs.reps % forms.length]
    // with handwriting on, every other review asks you to write the letter instead of reading it
    const wchars = hw ? lettersOf(pack, x.l.char) : []
    if (wchars.length && card.srs.reps % 2 === 1) { writeTarget = wchars[(card.srs.reps >> 1) % wchars.length]; warmTemplates(pack) }
    prompt = writeTarget
      ? <><p class="muted small">Write this letter:</p><p class="big"><b>{x.l.name}</b> · <span class="tr">{x.l.tr}</span></p><p class="small">{x.l.sound}</p>
          <WritePad pack={pack} strokes={strokes} onChange={setStrokes} readOnly={shown} /></>
      : <><p class="muted small">What sound is this letter? Say it.</p><p><T pack={pack} text={f} big className="letter" /></p></>
    answer = <>{writeTarget && <><VerdictLine pack={pack} v={verdict} /><p><T pack={pack} text={writeTarget} big className="letter" /></p></>}
      <p><b>{x.l.name}</b> · <span class="tr">{x.l.tr}</span></p><p class="small">{x.l.sound}</p><p><T pack={pack} text={x.l.ex.text} /> <span class="tr">{x.l.ex.tr}</span> · {x.l.ex.en}</p></>
  } else if (card.kind === 'mistake') {
    const e = card.extra ?? {}
    audio = e.correct ?? ''; expected = e.correct ?? ''
    prompt = <><p class="muted small">From your conversation. Fix this, out loud:</p><p class="strike"><T pack={pack} text={e.said ?? ''} big /></p></>
    answer = <><p><T pack={pack} text={e.correct ?? ''} big /></p>{e.note && <p class="muted">{e.note}</p>}</>
  }

  return (
    <div class="card">
      <div class="prompt">{prompt}</div>
      {!shown && card.kind !== 'listen' && card.kind !== 'read' && card.kind !== 'script' && expected && <TypeBox pack={pack} value={typed} onInput={setTyped} />}
      {wordPad() && (writing || pack.wordWriting === 'segment'
        ? <><WritePad pack={pack} strokes={strokes} onChange={setStrokes} readOnly={shown} aspect={WORD_ASPECT} />
            {!shown && pack.wordWriting === 'segment' && <p class="muted small">Write it on one line, without vowel points. It's checked letter by letter when you show the answer.</p>}
            {shown && pack.wordWriting !== 'segment' && <p class="muted small">Compare your writing with the answer below.</p>}</>
        : !shown && <button class="btn small" onClick={() => setWriting(true)}>✍︎ Write it by hand</button>)}
      {!shown ? (
        <button class="btn primary big" onClick={async () => {
          if (writeTarget) setVerdict(await checkLetter(pack, writeTarget, strokes))
          if (wordPad() && pack.wordWriting === 'segment' && strokes.length) setWordRes(await checkWord(pack, expected, strokes, WORD_ASPECT))
          setShown(true); if (audio) speak(respell(pack, audio), pack.tts).then(s => s && logEvent({ lang: pack.id, type: 'listen', seconds: s })) }}>Show answer</button>
      ) : (
        <>
          {wordRes !== undefined && <WordVerdict pack={pack} r={wordRes} />}
          <div class="answer">{answer}</div>
          {typed && expected && <p class={answerMatches(pack, typed, expected) ? 'ok' : 'warn'}>{answerMatches(pack, typed, expected) ? '✓ Your typing matches' : 'Your typing differs (vowel marks ignored)'}: <T pack={pack} text={typed} /></p>}
          {audio && <Speak pack={pack} text={audio} label="▶︎ Again" />}
          <GradeButtons card={card} onGrade={doGrade} />
          <Flag lang={card.lang} refId={flagRef} />
        </>
      )}
    </div>
  )
}

const LANG_NAME: Record<string, string> = { es: 'Spanish', en: 'English', it: 'Italian', fr: 'French', grc: 'Greek', la: 'Latin', sa: 'Sanskrit', ar: 'Arabic', he: 'Hebrew', zh: 'Chinese', ta: 'Tamil' }
function Cognates({ c }: { c?: Record<string, string> }) {
  if (!c) return null
  return <p class="small">≈ {Object.entries(c).map(([l, t], i) => <span key={l}>{i ? ' · ' : ''}{LANG_NAME[l] ?? l} <i>{t}</i></span>)}</p>
}

function Missing({ onSkip }: { onSkip: () => void }) {
  return <div class="card"><p>This card's content was removed from the pack.</p><button class="btn" onClick={onSkip}>Skip</button></div>
}

/** Positional forms using zero-width joiners (rendered by the system Arabic font). */
export function letterForms(ch: string, connects: boolean): string[] {
  const Z = '‍'
  if (ch.length > 1 || !/[؀-ۿ]/.test(ch)) return [ch]
  return connects ? [ch, ch + Z, Z + ch + Z, Z + ch] : [ch, Z + ch]
}

// ---------------- learn ----------------
function LearnRunner({ w, pack, refs, onDone }: { w: World; pack: Pack; refs: string[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const [created, setCreated] = useState<string[]>([])
  const [phase, setPhase] = useState<'intro' | 'recall'>('intro')
  if (phase === 'recall') return <ReviewRunner w={w} cardIds={created} onDone={onDone} title="First recall: try before you look." />
  const ref = refs[i]
  const done = async () => {
    const ids = await introduce(w, pack.id, ref)
    const all = [...created, ...ids]
    setCreated(all)
    if (i + 1 < refs.length) setI(i + 1)
    else if (all.length) setPhase('recall')
    else onDone()
  }
  return <div key={ref}><p class="muted small">{i + 1} of {refs.length}</p><Intro w={w} pack={pack} refStr={ref} onDone={done} /></div>
}

export function Intro({ w, pack, refStr, onDone }: { w: World; pack: Pack; refStr: string; onDone?: () => void }) {
  const [k, id] = parseRef(refStr)
  const { nav } = useApp()
  const btn = onDone && <button class="btn primary big" onClick={onDone}>Got it →</button>
  if (k === 'word') {
    const wd = wordById(pack, id)!
    const links = w.links.filter(l => l.items.some(x => x.lang === pack.id && ((wd.root && x.tr === wd.root) || normalize(pack, x.text) === normalize(pack, wd.text))))
    return (
      <div class="card">
        <p><T pack={pack} text={wd.text} big /> <Speak pack={pack} text={wd.text} /></p>
        <p class="tr">{wd.tr}</p>
        <p class="big">{wd.en}</p>
        {wd.root && <p class="small">Root <b>{wd.root}</b>{wd.pattern && <> · pattern {wd.pattern}</>}</p>}
        {wd.msa && <p class="small">MSA: <T pack={pack} text={wd.msa.text} /> {wd.msa.tr && <span class="tr">{wd.msa.tr}</span>} {wd.msa.note && <span class="muted">({wd.msa.note})</span>}</p>}
        <Cognates c={wd.cognates} />
        {wd.note && <p class="small muted">{wd.note}</p>}
        {links.map(l => <p class="small" key={l.id}>🔗 {l.note}: {l.items.filter(x => x.lang !== pack.id).map(x => <span key={x.lang}>{LANG_NAME[x.lang] ?? x.lang} <span lang={x.lang}>{x.text}</span> ({x.tr}) </span>)}</p>)}
        <hr />
        <p class="muted small">In a sentence. Listen, then shadow it (say it with or right after the model):</p>
        <p><T pack={pack} text={wd.ex.text} /></p>
        <p class="tr">{wd.ex.tr}</p><p class="muted">{wd.ex.en}</p>
        <RecordCompare pack={pack} text={wd.ex.text} />
        {handwritingOn() && pack.wordWriting === 'segment' && <WriteWord pack={pack} text={wd.text} en={wd.en} />}
        {!wd.verified && <p class="muted small">Unverified content.</p>}
        <Flag lang={pack.id} refId={refStr} text={wd.ex.text} />
        {btn}
      </div>
    )
  }
  if (k === 'grammar') {
    const g = grammarById(pack, id)!
    const c = g.concept ? w.concepts.find(x => x.id === g.concept) : undefined
    return (
      <div class="card">
        <h2>{g.title}</h2>
        {g.body.map((b, j) => <p key={j}><Rich text={b} /></p>)}
        {c && <p class="small">📘 Shared concept: <button class="link" onClick={() => nav({ name: 'concept', id: c.id })}>{c.title}</button></p>}
        {g.examples.map((e, j) => <div class="ex" key={j}><T pack={pack} text={e.text} /> <Speak pack={pack} text={e.text} /><p class="tr">{e.tr}</p><p class="muted">{e.en}</p></div>)}
        <p class="muted small">Next you'll produce {g.drills.length} sentences with this.</p>
        <Why id="explicit-grammar" />
        <Flag lang={pack.id} refId={refStr} />
        {btn}
      </div>
    )
  }
  if (k === 'script') {
    const s = scriptById(pack, id)!
    return (
      <div class="card">
        <h2>{s.title}</h2>
        {s.note && <p>{s.note}</p>}
        <div class="letters">
          {s.letters.map(l => (
            <div class="letter-card" key={l.id}>
              <p><T pack={pack} text={l.char} big className="letter" /></p>
              <p class="small forms">{letterForms(l.char, l.connects).slice(1).map((f, j) => <T key={j} pack={pack} text={f} />)}</p>
              <p><b>{l.name}</b> <span class="tr">{l.tr}</span></p>
              <p class="small">{l.sound}</p>
              <p><T pack={pack} text={l.ex.text} /> <Speak pack={pack} text={l.ex.text} /></p>
              <p class="small"><span class="tr">{l.ex.tr}</span> · {l.ex.en}</p>
              {handwritingOn() && lettersOf(pack, l.char).length > 0 && <WriteToggle pack={pack} chars={lettersOf(pack, l.char)} />}
            </div>
          ))}
        </div>
        <Flag lang={pack.id} refId={refStr} />
        {btn}
      </div>
    )
  }
  if (k === 'text') {
    const t = textById(pack, id)!
    return <div><ReaderView w={w} pack={pack} text={t} /><p class="muted small">Read it, tap words you don't know, listen, and shadow a line or two.</p>{btn}</div>
  }
  return null
}

function WriteToggle({ pack, chars }: { pack: Pack; chars: string[] }) {
  const [open, setOpen] = useState(false)
  return open ? <WriteLetter pack={pack} chars={chars} /> : <button class="btn small" onClick={() => setOpen(true)}>✍︎ Practise writing</button>
}

// ---------------- shadowing ----------------
function shadowLine(pack: Pack, ref: string) {
  const [k, id] = parseRef(ref)
  if (k === 'word') { const wd = wordById(pack, id); return wd && wd.ex }
  if (k === 'text') { const [tid, n] = id.split('#'); return textById(pack, tid)?.lines[Number(n) || 0] }
}

function ShadowRunner({ w, pack, refs, onDone }: { w: World; pack: Pack; refs: string[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const line = shadowLine(pack, refs[i])
  const prog = w.progress[pack.id]
  const next = async () => {
    prog.shadowed[refs[i]] = (prog.shadowed[refs[i]] ?? 0) + 1
    await saveProgress(pack.id, prog)
    if (i + 1 < refs.length) setI(i + 1); else onDone()
  }
  if (!line) { onDone(); return null }
  return (
    <div class="card" key={i}>
      <ol class="small steps"><li>Play the model twice.</li><li>Record yourself saying it along with or right after the model.</li><li>Play “Model + me” and listen for differences: sounds, stress, rhythm.</li></ol>
      <p><T pack={pack} text={line.text} big /></p>
      <p class="tr">{line.tr}</p><p class="muted">{line.en}</p>
      <RecordCompare pack={pack} text={line.text} />
      <p class="muted small">{pack.ttsNote}</p>
      <Why id="output" />
      <button class="btn primary big" onClick={next}>Next →</button>
    </div>
  )
}

// ---------------- reading ----------------
export function ReaderView({ w, pack, text }: { w: World; pack: Pack; text: Text }) {
  const [cards, setCards] = useState<CardRow[]>([])
  const [gloss, setGloss] = useState<{ tok: string; id?: string } | null>(null)
  const [showEn, setShowEn] = useState<Record<number, boolean>>({})
  useEffect(() => { store.getAllCards(pack.id).then(setCards) }, [])
  const learned = useMemo(() => learnedWordIds(cards, pack.id), [cards])
  const cov = useMemo(() => textCoverage(pack, text, learned), [learned])
  const lexAll = useMemo(() => buildLexicon(pack), [pack])
  const prog = w.progress[pack.id]
  const tr = showTranslit(w.settings, pack, prog, 'prompt')
  const g = gloss?.id ? wordById(pack, gloss.id) : undefined
  return (
    <div class="card reader">
      <h2>{text.title}</h2>
      <p class="small"><span class={`pill ${cov.ratio >= 0.95 ? 'ok' : cov.ratio >= 0.85 ? 'mid' : 'low'}`}>{Math.round(cov.ratio * 100)}% known</span>
        {' '}{cov.ratio >= 0.95 ? 'Good for fluent reading.' : cov.ratio >= 0.85 ? 'Stretch reading: use the glosses.' : 'Hard: many new words.'}
        {' '}<span class="muted">{text.v === 'msa' ? 'MSA' : text.v === 'lev' ? 'Levantine' : ''}</span></p>
      <Why id="coverage" />
      <Speak pack={pack} text={text.lines.map(l => l.text).join(' ، ')} label="▶︎ Play all" />
      {text.lines.map((l, j) => (
        <div class="line" key={j}>
          {l.sp && <span class="sp">{l.sp}: </span>}
          <span lang={pack.id} dir={pack.dir} class={`tl tl-${pack.id}`}>
            {l.text.split(/([\p{L}\p{M}\p{N}]+)/u).map((part, k) => tokenize(part).length
              ? <span key={k} class={`tok ${lookup(pack, buildLexiconCache(pack, learned), part) ? '' : 'new'}`} onClick={() => setGloss({ tok: part, id: lookup(pack, lexAll, part) })}>{w.settings.vowels ? part : stripVowels(pack, part)}</span>
              : <span key={k}>{part}</span>)}
          </span>
          <div class="line-tools">
            <Speak pack={pack} text={l.text} />
            <button class="link small" onClick={() => setShowEn({ ...showEn, [j]: !showEn[j] })}>{showEn[j] ? 'hide' : 'meaning'}</button>
          </div>
          {tr && l.tr && <p class="tr small">{l.tr}</p>}
          {showEn[j] && <p class="muted small">{l.en}</p>}
        </div>
      ))}
      {gloss && (
        <div class="gloss" onClick={() => setGloss(null)}>
          {g ? <><T pack={pack} text={g.text} /> <span class="tr">{g.tr}</span> · {g.en} {!learned.includes(g.id) && <span class="muted small">(not learned yet)</span>}</>
            : <><T pack={pack} text={gloss.tok} /> <span class="muted">is not in this pack yet.</span></>}
          <Flag lang={pack.id} refId={'text:' + text.id} text={gloss.tok} />
        </div>
      )}
      {text.source && <p class="muted small">Source: {text.source}</p>}
      {!text.verified && <p class="muted small">Unverified content.</p>}
    </div>
  )
}
const lexCache = new WeakMap<object, { key: string; lex: ReturnType<typeof buildLexicon> }>()
function buildLexiconCache(pack: Pack, ids: string[]) {
  const key = ids.join(',')
  const hit = lexCache.get(pack)
  if (hit?.key === key) return hit.lex
  const lex = buildLexicon(pack, ids)
  lexCache.set(pack, { key, lex })
  return lex
}

function ReadRunner({ w, pack, textId, onDone }: { w: World; pack: Pack; textId: string; onDone: () => void }) {
  const t = textById(pack, textId)
  const [secs] = useTimer(true)
  if (!t) { onDone(); return null }
  return (
    <div>
      <ReaderView w={w} pack={pack} text={t} />
      <button class="btn primary big" onClick={async () => {
        const prog = w.progress[pack.id]
        prog.textReads[t.id] = (prog.textReads[t.id] ?? 0) + 1
        await saveProgress(pack.id, prog)
        await logEvent({ lang: pack.id, type: 'read', seconds: secs, ref: t.id })
        onDone()
      }}>Finished reading →</button>
    </div>
  )
}

// ---------------- HVPT ----------------
interface Talker { name: string; play: (itemId: string, text: string) => Promise<void> }

async function talkersFor(pack: Pack, contrastId: string): Promise<Talker[]> {
  const out: Talker[] = []
  const voices = voicesFor(pack.tts)
  // shortcut: one iOS voice gives word variability but not true talker variability; recorded speakers fix that
  for (const v of voices.slice(0, 4)) for (const rate of [0.75, 1]) out.push({ name: `${v.name}${rate !== 1 ? ' (slow)' : ''}`, play: async (_id, text) => { await speak(respell(pack, text), pack.tts, { voice: v, rate }) } })
  if (!voices.length) out.push({ name: 'default voice', play: async (_id, text) => { await speak(respell(pack, text), pack.tts) } })
  const contrast = pack.contrasts.find(c => c.id === contrastId)!
  const recs = (await Promise.all(contrast.items.map(it => store.getRecordingsByRef(`hvpt:${contrastId}:${it.id}`)))).flat()
  const names = [...new Set(recs.map(r => r.talker!).filter(Boolean))]
  for (const n of names) out.push({
    name: n, play: async (itemId, text) => {
      const r = recs.find(x => x.talker === n && x.ref.endsWith(':' + itemId))
      if (r) await playBlob(r.blob); else await speak(respell(pack, text), pack.tts)
    },
  })
  return out
}

export function HvptRunner({ w, pack, contrastId, onDone, trials = 20 }: { w: World; pack: Pack; contrastId: string; onDone: () => void; trials?: number }) {
  const c = pack.contrasts.find(x => x.id === contrastId)!
  const [talkers, setTalkers] = useState<Talker[]>([])
  const [n, setN] = useState(0)
  const [score, setScore] = useState(0)
  const [cur, setCur] = useState<{ item: typeof c.items[0]; talker: Talker } | null>(null)
  const [answered, setAnswered] = useState<null | boolean>(null)
  const [t0] = useState(() => performance.now())
  useEffect(() => { talkersFor(pack, contrastId).then(setTalkers) }, [])
  const partner = (id: string) => { const i = c.items.findIndex(x => x.id === id); return c.items[i % 2 ? i - 1 : i + 1] }
  const newTrial = () => {
    const item = c.items[Math.floor(Math.random() * c.items.length)]
    const talker = talkers[Math.floor(Math.random() * talkers.length)]
    setCur({ item, talker }); setAnswered(null)
    talker.play(item.id, item.text)
  }
  const finish = async () => {
    const prog = w.progress[pack.id]
    await saveProgress(pack.id, prog)
    await logEvent({ lang: pack.id, type: 'hvpt', seconds: (performance.now() - t0) / 1000, ref: contrastId, score: n ? score / n : 0 })
    onDone()
  }
  if (!talkers.length) return <p>Loading voices…</p>
  if (n >= trials) return (
    <div class="card"><h2>{c.title}</h2><p>Score: <b>{score}/{n}</b> ({Math.round(100 * score / n)}%).</p>
      <p class="muted small">Talkers used: {talkers.map(t => t.name).join(', ')}. {talkers.length < 3 && 'Add a speaker in Library → Sounds for real talker variability.'}</p>
      <button class="btn primary big" onClick={finish}>Done →</button></div>
  )
  return (
    <div class="card hvpt">
      <h2>{c.title}</h2>
      <p class="muted small">Trial {n + 1}/{trials} · listen and choose the sound you hear. {c.note}</p>
      {!cur ? <button class="btn primary big" onClick={newTrial}>▶︎ Start</button> : <>
        <button class="btn" onClick={() => cur.talker.play(cur.item.id, cur.item.text)}>▶︎ Replay</button>
        <div class="choices">
          {(['a', 'b'] as const).map(side => (
            <button key={side} disabled={answered !== null} class={`btn choice ${answered !== null && cur.item.side === side ? 'correct' : ''}`} onClick={() => {
              const ok = side === cur.item.side
              setAnswered(ok); setN(n + 1); if (ok) setScore(score + 1)
              const prog = w.progress[pack.id]
              prog.hvpt[c.id] = [...(prog.hvpt[c.id] ?? []), ok ? 1 : 0].slice(-40)
            }}><T pack={pack} text={c[side].label} big /><small>{c[side].desc}</small></button>
          ))}
        </div>
        {answered !== null && <>
          <p class={answered ? 'ok' : 'warn'}>{answered ? '✓ Right' : '✗ Not quite'}: <T pack={pack} text={cur.item.text} /> <span class="tr">{cur.item.tr}</span> = {cur.item.en}</p>
          <button class="btn" onClick={async () => { const p = partner(cur.item.id); await cur.talker.play(cur.item.id, cur.item.text); if (p) await cur.talker.play(p.id, p.text) }}>▶︎ Hear the pair</button>
          <button class="btn primary" onClick={newTrial}>Next →</button>
        </>}
      </>}
      <Why id="hvpt" />
    </div>
  )
}

// ---------------- speaking ----------------
function SpeakRunner({ pack, promptId, onDone }: { pack: Pack; promptId: string; onDone: () => void }) {
  const p = pack.speaking.find(x => x.id === promptId)!
  return (
    <div class="card">
      <p class="big">{p.en}</p>
      {p.hints && <p class="small muted">Useful: {p.hints.join(' · ')}</p>}
      <p class="small">Talk for about a minute. Imperfect is fine; the point is getting words out of your mouth.</p>
      <SoloRecorder lang={pack.id} />
      <button class="btn primary big" onClick={onDone}>Done →</button>
    </div>
  )
}

function SoloRecorder({ lang, limit, onStop }: { lang: string; limit?: number; onStop?: (r: Recording) => void }) {
  const [rec, setRec] = useState<ActiveRecording | null>(null)
  const [mine, setMine] = useState<Recording | null>(null)
  const [err, setErr] = useState('')
  const [t, setT] = useTimer(!!rec)
  const stop = async () => { if (!rec) return; const r = await rec.stop(); setRec(null); setMine(r); logEvent({ lang, type: 'speak', seconds: r.seconds }); onStop?.(r) }
  useEffect(() => { if (limit && rec && t >= limit) stop() }, [t])
  useEffect(() => () => rec?.cancel(), [rec])
  return (
    <div class="rc">
      {!rec ? <button class="btn rec" onClick={async () => { setErr(''); setT(0); try { setRec(await startRecording()) } catch (e) { setErr((e as Error).message) } }}>● Record</button>
        : <button class="btn rec on" onClick={stop}>■ Stop {limit ? `(${Math.max(0, Math.ceil(limit - t))}s)` : `${Math.floor(t)}s`}</button>}
      {mine && <button class="btn" onClick={() => playBlob(mine.blob)}>▶︎ Listen back</button>}
      {err && <p class="warn small">{err}</p>}
    </div>
  )
}

function FluencyRunner({ pack, promptId, onDone }: { pack: Pack; promptId: string; onDone: () => void }) {
  const p = pack.speaking.find(x => x.id === promptId)!
  const rounds = [240, 180, 120]
  const [r, setR] = useState(0)
  return (
    <div class="card">
      <p class="big">{p.en}</p>
      {p.hints && <p class="small muted">Useful: {p.hints.join(' · ')}</p>}
      {r < 3 ? <>
        <p>Round {r + 1} of 3: tell it in <b>{rounds[r] / 60} minutes</b>. {r > 0 && 'Same content, less time: say it faster and smoother.'}</p>
        <SoloRecorder key={r} lang={pack.id} limit={rounds[r]} onStop={() => setR(r + 1)} />
      </> : <><p>Done. Listen back to round 1 vs round 3 next time; most people hear a clear speed-up.</p><button class="btn primary big" onClick={onDone}>Done →</button></>}
      <Why id="fluency-432" />
    </div>
  )
}
