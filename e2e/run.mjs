// End-to-end smoke test in WebKit (Safari's engine) with iPhone emulation, served under /languageLearner/
// like GitHub Pages. Run: npm run build && npm run e2e   (screenshots go to e2e/shots/)
import { webkit, devices } from 'playwright'
import http from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { gunzipSync } from 'node:zlib'

const DIST = new URL('../dist/', import.meta.url).pathname
const SHOTS = new URL('./shots/', import.meta.url).pathname
const PREFIX = '/languageLearner/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (!url.startsWith(PREFIX)) { res.writeHead(404); return res.end() }
  let p = normalize(join(DIST, url.slice(PREFIX.length) || 'index.html'))
  if (p.endsWith('/')) p += 'index.html'
  try { const b = await readFile(p); res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(b) }
  catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(4321, r))
await mkdir(SHOTS, { recursive: true })

const errors = []
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`) }

const browser = await webkit.launch()
// serviceWorkers: 'block' so the fake GitHub routes below see every request (the app's SW ignores cross-origin anyway)
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true, serviceWorkers: 'block' })
// headless WebKit has no share sheet; force the download fallback (on iPhone the share sheet is used)
await ctx.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
// a 404 from the (fake) GitHub API is expected on the first sync: the sync file doesn't exist yet
page.on('console', m => { if (m.type() === 'error' && !m.location().url.startsWith('https://api.github.com/')) errors.push('console: ' + m.text()) })
page.on('dialog', d => d.accept())
const shot = name => page.screenshot({ path: SHOTS + name + '.png', fullPage: true })
const btn = (name, exact = false) => page.getByRole('button', { name, exact })
const visible = async loc => (await loc.count()) > 0 && await loc.first().isVisible()

try {
  await page.goto(`http://localhost:4321${PREFIX}`)
  await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 10000 })
  check('loads under /languageLearner/ and shows Today', true)
  check('install banner shown in a Safari tab', await visible(page.getByText('Add to Home Screen')))
  await shot('01-today')

  // ---- a 5-minute day-one session ----
  await btn(/^5\s*min/).click()
  await page.getByText('New material').first().waitFor()
  check('5-min day-one plan = new material + shadowing', await visible(page.getByText('Shadowing (speak)')))
  await shot('02-plan')
  await btn('Start', true).click()
  let steps = 0, sawCard = false, sawIntro = false
  while (steps++ < 80) {
    if (await visible(btn('Back to Today'))) break
    try {
      if (await visible(btn('Got it →'))) {
        if (!sawIntro && await visible(page.locator('.letter-card'))) { await shot('03-script-lesson'); sawIntro = true }
        await btn('Got it →').click({ timeout: 3000 }); continue
      }
      if (await visible(btn('Show answer'))) {
        if (!sawCard) await shot('04-card-prompt')
        await btn('Show answer').click({ timeout: 3000 })
        if (!sawCard) { await shot('05-card-answer'); sawCard = true }
        await page.locator('.grade.good').click({ timeout: 3000 }); continue
      }
      if (await visible(btn('Next →'))) { await shot('06-shadow'); await btn('Next →').click({ timeout: 3000 }); continue }
    } catch (e) { console.log('  (retrying step: ' + e.message.split('\n')[0] + ')') }
    await page.waitForTimeout(300)
  }
  check('session runs to the end', await visible(btn('Back to Today')), `${steps} steps`)
  check('review cards appeared after new material', sawCard)
  await btn('Back to Today').click()

  // ---- RTL + reader ----
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Readers').click()
  await page.getByRole('button', { name: /Meeting at the conversation table/ }).click()
  const dir = await page.locator('.line .tl-ar').first().evaluate(el => getComputedStyle(el).direction)
  check('Arabic text renders right-to-left', dir === 'rtl', dir)
  const rtlOrder = await page.locator('.line .tl-ar').nth(1).evaluate(el => {
    const toks = el.querySelectorAll('.tok'); if (toks.length < 2) return 'n/a'
    return toks[0].getBoundingClientRect().left > toks[1].getBoundingClientRect().left ? 'first word on the right' : 'WRONG ORDER'
  })
  check('first Arabic word is on the right', rtlOrder !== 'WRONG ORDER', rtlOrder)
  await page.locator('.tok').nth(1).click()
  check('tap-to-gloss works', await page.locator('.gloss').waitFor({ timeout: 5000 }).then(() => true, () => false))
  await shot('07-reader-rtl')

  // ---- conversation round trip ----
  await page.getByRole('button', { name: /Today/ }).last().click()
  await btn(/Conversation session/).click()
  await btn('Copy prompt').click()
  check('prompt copied', await visible(btn('✓ Copied')))
  await page.locator('textarea').nth(1).fill('Sure!\n\nMISTAKES\nsaid | correct | note\nأنا بدي روح | بدي روح | pronoun not needed\nكتبت هو | هو كتب | 3rd person past')
  await btn('Check').click()
  await btn(/Make 2 review cards/).click()
  check('mistakes become review cards', await page.getByText('2 review cards added').waitFor({ timeout: 5000 }).then(() => true, () => false))
  await shot('08-conversation')

  // ---- HVPT ----
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Sounds (HVPT)').click()
  await page.getByRole('button', { name: /س s vs ص/ }).click()
  await btn('▶︎ Start').click()
  await page.locator('.choice').first().click()
  check('HVPT trial gives feedback', await page.getByText(/Right|Not quite/).first().waitFor({ timeout: 5000 }).then(() => true, () => false))
  await shot('09-hvpt')

  // ---- diagnostics: every script ----
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await btn(/Diagnostics/).click()
  await page.getByText('Script rendering').waitFor()
  await shot('10-diagnostics-scripts')
  const heDir = await page.locator('.tl-he').first().evaluate(el => getComputedStyle(el).direction)
  check('Hebrew sample renders right-to-left', heDir === 'rtl', heDir)

  // ---- backup export → import ----
  await page.getByRole('button', { name: /Settings/ }).last().click()
  const [dl] = await Promise.all([page.waitForEvent('download'), btn('⬆︎ Export backup').click()])
  const file = SHOTS + 'backup.json'
  await dl.saveAs(file)
  const backup = JSON.parse(await readFile(file, 'utf8'))
  check('backup file exported', backup.format === 'polyglot-backup' && backup.data.cards.length > 0, `${backup.data.cards.length} cards`)
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByText('Restored').waitFor({ timeout: 5000 })
  await page.waitForTimeout(2500) // app reloads itself after restoring
  await page.getByRole('button', { name: /Progress/ }).last().click()
  await page.getByText('words learning').first().waitFor()
  const learning = await page.locator('.metrics div').nth(1).locator('b').first().textContent()
  check('import restores progress', Number(learning) > 0, `${learning} words learning`)
  await shot('11-progress')

  // ---- Latin: activate, two-language session, reader ----
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await btn(/Choose active/).click()
  await page.locator('.row', { hasText: 'Latin' }).locator('select').selectOption('active')
  await page.getByRole('button', { name: /Today/ }).last().click()
  check('Latin card appears on Today', await page.getByText('Latin (Classical, active method)').first().waitFor({ timeout: 8000 }).then(() => true, () => false))
  await btn(/^15\s*min/).click()
  await page.getByText('New material').first().waitFor()
  const planText = await page.locator('.plan').innerText()
  check('15-min plan covers both active languages', planText.includes('Arabic') && planText.includes('Latin'))
  await btn('Start', true).click()
  let lsteps = 0, sawRead = false, sawPron = false
  while (lsteps++ < 140) {
    if (await visible(btn('Back to Today'))) break
    try {
      if (await visible(btn('Got it →'))) {
        if (!sawPron && await visible(page.getByText('Pronunciation 1'))) { await shot('13-latin-pronunciation'); sawPron = true }
        await btn('Got it →').click({ timeout: 3000 }); continue
      }
      if (await visible(btn('Show answer'))) {
        if (!sawRead && await visible(page.getByText('Read it aloud. What does it mean?'))) { await shot('14-latin-read-card'); sawRead = true }
        await btn('Show answer').click({ timeout: 3000 }); await page.locator('.grade.good').click({ timeout: 3000 }); continue
      }
      if (await visible(btn('Next →'))) { await btn('Next →').click({ timeout: 3000 }); continue }
      if (await visible(btn('Done →'))) { await btn('Done →').click({ timeout: 3000 }); continue }
      if (await visible(btn(/Finished reading/))) { await btn(/Finished reading/).click({ timeout: 3000 }); continue }
      if (await visible(btn('▶︎ Start'))) { await btn('Skip this part').click({ timeout: 3000 }); continue }
    } catch (e) { console.log('  (retrying step: ' + e.message.split('\n')[0] + ')') }
    await page.waitForTimeout(250)
  }
  check('two-language session runs to the end', await visible(btn('Back to Today')), `${lsteps} steps`)
  check('Latin pronunciation lesson shown', sawPron)
  check('Latin reading card shown', sawRead)
  await btn('Back to Today').click()
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Latin', true).click()
  await btn('Readers').click()
  await page.getByRole('button', { name: /Caesar, Dē Bellō/ }).click()
  await page.locator('.reader').waitFor()
  const laDir = await page.locator('.line .tl-la').first().evaluate(el => getComputedStyle(el).direction)
  check('Latin renders left-to-right', laDir === 'ltr', laDir)
  await shot('15-latin-caesar')
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await page.getByText('Show vowel marks').click()
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Latin', true).click()
  await btn('Readers').click()
  await page.getByRole('button', { name: /Rōma et Hispānia|Roma et Hispania/ }).click()
  const plain = await page.locator('.line .tl-la').first().innerText()
  check('macron toggle hides macrons', !/[āēīōū]/.test(plain), plain.slice(0, 30))
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await page.getByText('Show vowel marks').click()

  // ---- Hebrew: activate (Latin to maintenance), session, reader, links, HVPT ----
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await btn(/Choose active/).click()
  await page.locator('.row', { hasText: 'Latin' }).locator('select').selectOption('maintenance')
  await page.locator('.row', { hasText: 'Hebrew' }).locator('select').selectOption('active')
  await page.getByRole('button', { name: /Today/ }).last().click()
  check('Hebrew card appears on Today', await page.getByText('Hebrew (Modern, with a bridge to Biblical)').first().waitFor({ timeout: 8000 }).then(() => true, () => false))
  check('Latin listed as maintenance', await visible(page.getByText(/Maintenance \(reviews only/)))
  await btn(/^30\s*min/).click()
  await page.getByText('New material').first().waitFor()
  const plan3 = await page.locator('.plan').innerText()
  check('30-min plan: Arabic + Hebrew active', plan3.includes('Arabic') && plan3.includes('Hebrew'))
  await btn('Start', true).click()
  let hsteps = 0, sawHeScript = false
  while (hsteps++ < 220) {
    if (await visible(btn('Back to Today'))) break
    try {
      if (await visible(btn('Got it →'))) {
        if (!sawHeScript && await visible(page.getByText('Letters 1: א ב ג ד ה ו'))) { await shot('16-hebrew-letters'); sawHeScript = true }
        await btn('Got it →').click({ timeout: 3000 }); continue
      }
      if (await visible(btn('Show answer'))) { await btn('Show answer').click({ timeout: 3000 }); await page.locator('.grade.good').click({ timeout: 3000 }); continue }
      if (await visible(btn('Next →'))) { await btn('Next →').click({ timeout: 3000 }); continue }
      if (await visible(btn('Done →'))) { await btn('Done →').click({ timeout: 3000 }); continue }
      if (await visible(btn(/Finished reading/))) { await btn(/Finished reading/).click({ timeout: 3000 }); continue }
      if (await visible(btn('▶︎ Start')) || await visible(page.locator('.rec'))) { await btn('Skip this part').click({ timeout: 3000 }); continue }
    } catch (e) { console.log('  (retrying step: ' + e.message.split('\n')[0] + ')') }
    await page.waitForTimeout(250)
  }
  check('Arabic + Hebrew session runs to the end', await visible(btn('Back to Today')), `${hsteps} steps`)
  check('Hebrew script lesson shown', sawHeScript)
  await btn('Back to Today').click()
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Hebrew', true).click()
  await btn('Readers').click()
  await page.getByRole('button', { name: /Genesis 1:1/ }).click()
  await page.locator('.reader').waitFor()
  const heDir2 = await page.locator('.line .tl-he').first().evaluate(el => getComputedStyle(el).direction)
  check('Hebrew reader renders right-to-left', heDir2 === 'rtl', heDir2)
  const heOrder = await page.locator('.line .tl-he').first().evaluate(el => {
    const t = el.querySelectorAll('.tok'); return t[0].getBoundingClientRect().left > t[1].getBoundingClientRect().left ? 'first word on the right' : 'WRONG ORDER'
  })
  check('first Hebrew word is on the right', heOrder !== 'WRONG ORDER', heOrder)
  await shot('17-hebrew-genesis')
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await page.getByText('Show vowel marks').click()
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Hebrew', true).click()
  await btn('Readers').click()
  await page.getByRole('button', { name: /Genesis 1:1/ }).click()
  const unpointed = await page.locator('.line .tl-he').first().innerText()
  check('niqqud toggle hides vowel points', !/[ְ-ּׁׂ]/.test(unpointed), unpointed.slice(0, 20))
  await shot('18-hebrew-no-niqqud')
  await page.getByRole('button', { name: /Settings/ }).last().click()
  await page.getByText('Show vowel marks').click()
  // cross-language root link shown on a Hebrew word
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Hebrew', true).click()
  await btn('Words', true).click()
  await page.getByRole('button', { name: /wrote/ }).first().click()
  check('Hebrew word shows its Arabic root link', await page.getByText(/Arabic/).first().waitFor({ timeout: 5000 }).then(() => true, () => false))
  await shot('19-hebrew-arabic-link')
  await page.getByRole('button', { name: /Library/ }).last().click()
  await btn('Hebrew', true).click()
  await btn('Sounds (HVPT)').click()
  await page.getByRole('button', { name: /r vs/ }).click()
  await btn('▶︎ Start').click()
  await page.locator('.choice').first().click()
  check('Hebrew HVPT trial gives feedback', await page.getByText(/Right|Not quite/).first().waitFor({ timeout: 5000 }).then(() => true, () => false))

  // ---- cross-device sync, against a fake GitHub contents API shared by two "devices" ----
  const gh = { file: null, sha: 0, puts: 0 }
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, X-GitHub-Api-Version', 'access-control-allow-methods': 'GET, PUT' }
  const fakeGitHub = async route => {
    const req = route.request(), url = new URL(req.url())
    const f = route.fulfill.bind(route); route = { fulfill: o => f({ ...o, headers: CORS }) }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 })
    if (req.headers()['authorization'] !== 'Bearer test-token') return route.fulfill({ status: 401, body: '{}' })
    if (url.pathname === '/repos/test/polyglot-data') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    if (url.pathname !== '/repos/test/polyglot-data/contents/polyglot-sync.json.gz') return route.fulfill({ status: 404, body: '{}' })
    if (req.method() === 'GET') return gh.file ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: gh.file, sha: 's' + gh.sha }) }) : route.fulfill({ status: 404, body: '{}' })
    const body = JSON.parse(req.postData())
    if (gh.file && body.sha !== 's' + gh.sha) return route.fulfill({ status: 409, body: '{}' })
    gh.file = body.content; gh.sha++; gh.puts++
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  }
  const countCards = pg => pg.evaluate(() => new Promise(res => { const r = indexedDB.open('polyglot'); r.onsuccess = () => { const q = r.result.transaction('cards').objectStore('cards').count(); q.onsuccess = () => res(q.result) } }))
  const connect = async pg => {
    await pg.getByRole('button', { name: /Settings/ }).last().click()
    await pg.getByLabel('Repo').fill('test/polyglot-data')
    await pg.getByLabel('Token').fill('test-token')
    await pg.getByRole('button', { name: 'Connect and sync' }).click()
    return pg.getByText(/✓ Synced/).waitFor({ timeout: 8000 }).then(() => true, () => false)
  }
  await ctx.route('https://api.github.com/**', fakeGitHub)
  check('phone connects to sync and uploads', await connect(page) && gh.puts === 1)
  await shot('13-sync-settings')
  const synced = gunzipSync(Buffer.from(gh.file, 'base64')).toString()
  check('synced file is a valid backup without the token', JSON.parse(synced).format === 'polyglot-backup' && !synced.includes('test-token'))
  const phoneCards = await countCards(page)

  const ipadCtx = await browser.newContext({ ...devices['iPad Pro 11'], serviceWorkers: 'block' })
  await ipadCtx.route('https://api.github.com/**', fakeGitHub)
  const ipad = await ipadCtx.newPage()
  ipad.on('pageerror', e => errors.push('ipad pageerror: ' + e.message))
  ipad.on('dialog', d => d.accept())
  await ipad.goto(`http://localhost:4321${PREFIX}`)
  await ipad.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 10000 })
  check('a fresh iPad starts empty', (await countCards(ipad)) === 0)
  check('iPad connects and pulls the phone\'s progress', await connect(ipad))
  await ipad.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 10000 }) // it reloads after pulling
  await ipad.waitForTimeout(500)
  check('iPad has every phone card', (await countCards(ipad)) === phoneCards, `${phoneCards} cards`)
  check('iPad picked up the phone\'s languages', await ipad.getByText('Hebrew (Modern, with a bridge to Biblical)').first().waitFor({ timeout: 8000 }).then(() => true, () => false))
  await ipad.screenshot({ path: SHOTS + '14-ipad-after-sync.png', fullPage: true })

  // a change on the iPad (turn vowel marks off) reaches the phone
  await ipad.getByRole('button', { name: /Settings/ }).last().click()
  const vowelBox = ipad.getByLabel(/Show vowel marks/)
  const before = await vowelBox.isChecked()
  await vowelBox.click()
  await ipad.getByRole('button', { name: '↻ Sync now' }).click()
  await ipad.getByText(/✓ Synced/).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: '↻ Sync now' }).click()
  await page.getByText(/✓ Synced/).waitFor({ timeout: 8000 })
  await page.waitForTimeout(1500) // reloads after pulling
  await page.getByRole('button', { name: /Settings/ }).last().click()
  check('a setting changed on the iPad reaches the phone', (await page.getByLabel(/Show vowel marks/).isChecked()) === !before)
  check('bad token gives a readable error', await (async () => {
    const c = await browser.newContext({ serviceWorkers: 'block' }); await c.route('https://api.github.com/**', fakeGitHub); const pg = await c.newPage()
    await pg.goto(`http://localhost:4321${PREFIX}`); await pg.getByRole('button', { name: /Settings/ }).last().click()
    await pg.getByLabel('Repo').fill('test/polyglot-data'); await pg.getByLabel('Token').fill('wrong'); await pg.getByRole('button', { name: 'Connect and sync' }).click()
    const ok = await pg.getByText(/rejected the token/).waitFor({ timeout: 8000 }).then(() => true, () => false)
    await c.close(); return ok
  })())
  // ---- handwriting on iPad (on by default there) ----
  await ipad.getByRole('button', { name: /Library/ }).last().click()
  await ipad.getByRole('button', { name: 'Arabic', exact: true }).click().catch(() => {})
  await ipad.getByText(/^1 · Hello/).first().click()
  await ipad.getByText(/Letters 1:/).first().click()
  await ipad.getByRole('button', { name: '✍︎ Practise writing' }).first().click()
  const pad = ipad.getByLabel('Writing area: draw the letter here')
  const stroke = async (pts) => {
    const b = await pad.boundingBox()
    await ipad.mouse.move(b.x + pts[0][0] * b.width, b.y + pts[0][1] * b.height); await ipad.mouse.down()
    for (const [x, y] of pts.slice(1)) await ipad.mouse.move(b.x + x * b.width, b.y + y * b.height, { steps: 8 })
    await ipad.mouse.up()
  }
  await stroke([[0.53, 0.38], [0.52, 0.72]])   // alif: one vertical stroke
  await ipad.getByRole('button', { name: 'Check', exact: true }).click()
  check('iPad: a written alif is accepted', await ipad.getByText("✓ That's it.").waitFor({ timeout: 10000 }).then(() => true, () => false))
  await ipad.screenshot({ path: SHOTS + '15-ipad-write-alif.png', fullPage: false })
  await ipad.getByRole('button', { name: 'Clear', exact: true }).click()
  await stroke([[0.1, 0.6], [0.9, 0.6]]); await stroke([[0.5, 0.83], [0.51, 0.84]])  // a bā' shape
  await ipad.getByRole('button', { name: 'Check', exact: true }).click()
  check('iPad: a bā\' written for alif is caught and named', await ipad.getByText(/looks more like|could be read as/).waitFor({ timeout: 10000 }).then(() => true, () => false))
  await ipad.screenshot({ path: SHOTS + '16-ipad-write-wrong.png', fullPage: false })
  await ipadCtx.close()

  // ---- dark mode + manifest ----
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('button', { name: /Today/ }).last().click()
  await shot('12-today-dark')
  const manifest = await (await page.request.get(`http://localhost:4321${PREFIX}manifest.webmanifest`)).json()
  check('manifest is standalone with icons', manifest.display === 'standalone' && manifest.icons.length >= 2)
  const icon = await page.request.get(`http://localhost:4321${PREFIX}icons/apple-touch-icon.png`)
  check('apple-touch-icon served', icon.ok())
} catch (e) {
  check('e2e crashed', false, e.message)
  await shot('99-crash').catch(() => {})
}
check('no console or page errors', errors.length === 0, errors.slice(0, 5).join(' | '))
await writeFile(SHOTS + 'results.json', JSON.stringify({ results, errors }, null, 2))
await browser.close(); server.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
