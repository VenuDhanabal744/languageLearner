// End-to-end smoke test in WebKit (Safari's engine) with iPhone emulation, served under /languageLearner/
// like GitHub Pages. Run: npm run build && npm run e2e   (screenshots go to e2e/shots/)
import { webkit, devices } from 'playwright'
import http from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

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
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true })
// headless WebKit has no share sheet; force the download fallback (on iPhone the share sheet is used)
await ctx.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
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
