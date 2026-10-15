// The development-only component gallery, at ?gallery (see src/gallery/Gallery.tsx). Only the
// dev server has it, so these checks skip unless BASE_URL is the dev server: it alone serves
// Vite's client script. The gallery asks AniList for nothing, so AniList is blocked here as a
// backstop, and every request to it is counted.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
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
    app: Boolean(document.querySelector('.ab-intro, #ab-trending, #pull')),
  })`)
  assert.equal(page.heading, 'AniBeam component gallery')
  assert.equal(page.app, false, "the app's sections show under ?gallery")
  assert.deepEqual(browser.problems, [], 'the console has errors or warnings')
  assert.deepEqual(aniList, [], 'the gallery sent AniList requests')
})
