// "Conversation session": a prompt you paste into your own Claude chat, and a parser for the mistakes it sends back.
export interface PromptInput {
  language: string                 // e.g. "Levantine Arabic (Shami)"
  level: string                    // e.g. "Unit 4 of 14, ~90 words"
  showTranslit: boolean
  knownWords: { text: string; tr: string; en: string }[]
  grammar: string[]
  scenario: { title: string; setup: string; you: string; partner: string }
}

export function buildConversationPrompt(p: PromptInput): string {
  const vocab = p.knownWords.slice(0, 250).map(w => `${w.text} (${w.tr}) = ${w.en}`).join('; ')
  return [
    `You are my conversation partner for speaking practice in ${p.language}. Stay in ${p.language} the whole time (not another variety, not English) except where these rules say otherwise.`,
    ``,
    `MY LEVEL: ${p.level}.`,
    `WORDS I KNOW (use mostly these; at most one new word per turn, glossed in English in [brackets]): ${vocab || '(almost none yet: keep it to greetings and very short phrases)'}`,
    `GRAMMAR I'M PRACTISING: ${p.grammar.join('; ') || 'basic sentences'}`,
    ``,
    `ROLE-PLAY: ${p.scenario.title}. ${p.scenario.setup} You play: ${p.scenario.partner}. I play: ${p.scenario.you}.`,
    ``,
    `RULES:`,
    `- Keep each of your turns to 1–2 short sentences and end with a question or prompt so I must answer.`,
    `- Write in the native script${p.showTranslit ? ', then put a transliteration on the next line' : ''}.`,
    `- Do not correct me during the conversation unless you cannot understand me; silently keep a list of my mistakes (grammar, word choice, wrong variety).`,
    `- If I write "?" explain your last line briefly in English, then continue.`,
    `- When I write END, reply with ONLY the block below, no other text. One line per mistake, at most 10, most important first. "said" and "correct" in the native script; "note" in English, max 10 words.`,
    ``,
    `MISTAKES`,
    `said | correct | note`,
    ``,
    `Start the role-play now with your first line.`,
  ].join('\n')
}

export interface Mistake { said: string; correct: string; note: string }

export function parseMistakes(text: string): Mistake[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const start = lines.findIndex(l => /^\W*mistakes\W*$/i.test(l.trim()))
  const body = start >= 0 ? lines.slice(start + 1) : lines
  const out: Mistake[] = []
  for (const raw of body) {
    let l = raw.trim().replace(/^[-*•\d.)\s]+(?=\S)/u, '')
    l = l.replace(/^`+|`+$/g, '')
    if (!l.includes('|')) continue
    l = l.replace(/^\|/, '').replace(/\|$/, '')
    const parts = l.split('|').map(s => s.trim())
    if (parts.length < 2) continue
    const [said, correct, ...rest] = parts
    if (/^:?-{2,}:?$/.test(said) || (/^said$/i.test(said) && /^correct$/i.test(correct))) continue
    if (!correct) continue
    out.push({ said, correct, note: rest.join(' | ') })
  }
  return out
}
