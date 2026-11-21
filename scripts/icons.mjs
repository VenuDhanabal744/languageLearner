// Render public/icons/icon.svg to the PNG sizes iOS and the manifest need. Run: node scripts/icons.mjs
import { webkit } from 'playwright'
import { readFile } from 'node:fs/promises'
const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8')
const browser = await webkit.launch()
for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`)
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: false })
  await page.close()
}
await browser.close()
console.log('icons written')
