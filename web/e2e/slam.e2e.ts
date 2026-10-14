// Draft PR 3 (phase-2-proto-scroll, never merged): the scroll-slam prototype, with each engine
// (see src/slam/switch.ts). Its own file, so the engines' pages stay in a profile of their own.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { BASE_URL, Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

const ENGINES = ['native', 'gsap'] as const
const withEngine = (engine: string) => `${BASE_URL}?motion=${engine}`

test('?motion=native and ?motion=gsap start the prototype, and without them nothing changes', async () => {
  const started: Record<string, string | null> = {}
  for (const engine of ENGINES) {
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    started[engine] = await browser.evaluate<string | null>(
      `document.documentElement.dataset.slam ?? null`,
    )
  }
  await browser.load()
  assert.ok(await browser.titlesShown())
  started.none = await browser.evaluate<string | null>(
    `document.documentElement.dataset.slam ?? null`,
  )
  assert.deepEqual(started, { native: 'native', gsap: 'gsap', none: null })
})
