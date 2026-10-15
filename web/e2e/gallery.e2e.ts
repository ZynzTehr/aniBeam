// The development-only component gallery, at ?gallery (see src/gallery/Gallery.tsx). Only the
// dev server has it, so these checks skip unless BASE_URL is the dev server: it alone serves
// Vite's client script. The gallery asks AniList for nothing, so AniList is blocked here as a
// backstop, and every request to it is counted.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { titleOf } from '../src/features/anime/format.ts'
import { mediaOf, TITLE_CASES } from '../src/gallery/cases.ts'
import { BASE_URL, Browser } from './browser.ts'

const GALLERY = new URL('?gallery', BASE_URL).href
const dev = await fetch(new URL('@vite/client', BASE_URL))
  .then((answer) => answer.ok && /javascript/.test(answer.headers.get('content-type') ?? ''))
  .catch(() => false)
const skip = !dev && `the gallery is development-only, and ${BASE_URL} is not the dev server`

let browser: Browser
// Requests the page sent AniList, whatever came of them.
const aniList: string[] = []
before(async () => {
  if (!dev) return
  browser = await Browser.open()
  await browser.blockAniList()
  await browser.send('Network.enable')
  browser.onEvent('Network.requestWillBeSent', ({ request }) => {
    if (new URL(request.url).hostname === 'graphql.anilist.co') aniList.push(request.method)
  })
})
after(() => browser?.close())

test('?gallery shows the gallery, not the app', { skip }, async () => {
  await browser.load({ url: GALLERY })
  const page = await browser.evaluate<{ heading: string; app: boolean }>(`({
    heading: document.querySelector('main h1')?.textContent ?? '',
    app: Boolean(document.querySelector('#ab-trending, #decades')),
  })`)
  assert.equal(page.heading, 'AniBeam component gallery')
  assert.equal(page.app, false, "the app's sections show under ?gallery")
})

test(
  'every title case shows on the trending page and on the strip, its gap and all',
  { skip },
  async () => {
    await browser.load({ url: GALLERY })
    await browser.animationsDone()
    const shown = await browser.evaluate<{
      listed: string[]
      panels: string[]
      strip: string[]
      broken: boolean[]
      small: string
      wide: string
      banner: boolean
    }>(`(() => {
    const panels = [...document.querySelectorAll('[aria-labelledby="gal-panels"] .ab-grid > li')]
    const strip = [...document.querySelectorAll('[aria-labelledby="gal-strip"] .ab-strip-item')]
    const titles = (items, selector) => items.map((item) => item.querySelector(selector)?.textContent ?? '')
    const at = (label) => ${JSON.stringify(TITLE_CASES.map(({ label }) => label))}.indexOf(label)
    return {
      listed: [...document.querySelectorAll('.gal-cases > li > b')].map((b) => b.textContent),
      panels: titles(panels, '.ab-caption b'),
      strip: titles(strip, '.ab-strip-title'),
      broken: [panels, strip].map((items) => items[at('A cover that fails to load')]?.querySelector('img')?.hasAttribute('data-broken')),
      small: panels[at('The small 230px cover')]?.querySelector('img')?.getAttribute('src') ?? '',
      wide: strip[at('A wide cover')]?.querySelector('img')?.getAttribute('src') ?? '',
      banner: Boolean(panels[at('No banner')]?.querySelector('source')),
    }
  })()`)
    const titles = TITLE_CASES.map((edge) => titleOf(mediaOf(edge)))
    assert.deepEqual(
      shown.listed,
      TITLE_CASES.map(({ label }) => label),
      'the list of cases',
    )
    assert.deepEqual(shown.panels, titles.slice(0, 9), "the trending page's panels")
    assert.deepEqual(shown.strip, titles, "the strip's covers")
    assert.deepEqual(
      shown.broken,
      [true, true],
      'the cover that fails to load is not marked broken',
    )
    assert.match(shown.small, /\/cover\/medium\//, 'the small cover case shows a big cover')
    assert.match(shown.wide, /\/10743\.jpg$/, 'the wide cover case shows another cover')
    assert.equal(shown.banner, false, 'the splash panel offers a banner it has not got')
  },
)

test('nothing on the gallery scrolls sideways, on a phone or a wide screen', { skip }, async () => {
  const wider: string[] = []
  for (const screen of [
    { width: 390, height: 844, phone: true },
    { width: 1440, height: 900 },
  ]) {
    await browser.load({ url: GALLERY, ...screen })
    await browser.animationsDone()
    const page = await browser.evaluate<{ scroll: number; view: number }>(
      `({ scroll: document.documentElement.scrollWidth, view: document.documentElement.clientWidth })`,
    )
    if (page.scroll > page.view) wider.push(`${screen.width}px: ${page.scroll}px wide`)
  }
  assert.deepEqual(wider, [], 'the gallery scrolls sideways')
})

// Last, so it covers every check above.
test(
  'across the checks above, the console stayed clean and AniList got no request',
  { skip },
  () => {
    assert.deepEqual(browser.problems, [], 'the console has errors or warnings')
    assert.deepEqual(aniList, [], 'the gallery sent AniList requests')
  },
)
