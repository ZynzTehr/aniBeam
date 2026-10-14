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

// The parts that land as they scroll into view: trending panels, decade and search cards (their
// list items), the pull machine and the section headings (see src/slam/parts.ts).
const PARTS = `[...document.querySelectorAll('.ab-grid:not([aria-hidden]) > .ab-panel, .ab-strip-row:not([aria-hidden]) > .ab-strip-item, .ab-machine, .ab-sfx')]`
// The page's load-time entrances (components.css), which these parts must not play as well.
const ENTRANCES = ['ab-ink', 'ab-settle', 'ab-pop', 'ab-boom']

/** Parts the prototype hasn't marked, and parts playing a load-time entrance, by class. */
const unclaimed = () =>
  browser.evaluate<{ unmarked: string[]; entering: string[] }>(`(() => {
    const parts = ${PARTS}
    const name = (el) => el.className.split(' ')[0]
    return {
      unmarked: parts.filter((el) => !el.dataset.land).map(name),
      entering: parts.filter((el) => el.getAnimations({ subtree: true }).some((a) => ${JSON.stringify(ENTRANCES)}.includes(a.animationName))).map(name),
    }
  })()`)

for (const engine of ENGINES)
  test(`with ${engine}, every part is the prototype's, on load and as new ones arrive, and plays no load-time entrance`, async () => {
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    const onLoad = await unclaimed()
    // New parts: another decade's cards.
    const first = `document.querySelector('[aria-labelledby="decades"] .ab-strip-row:not([aria-hidden]) .ab-strip-title')?.textContent`
    const before = await browser.evaluate<string>(first)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    assert.ok(
      await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(before)}`),
      'the strip kept the 1990s titles',
    )
    const later = await unclaimed()
    assert.deepEqual(
      { onLoad, later },
      {
        onLoad: { unmarked: [], entering: [] },
        later: { unmarked: [], entering: [] },
      },
    )
  })

test('the knobs come from the address, and out-of-range values are ignored', async () => {
  const knobs = `(() => {
    const style = getComputedStyle(document.documentElement)
    return ['--slam-scale', '--slam-tilt', '--slam-stagger'].map((name) => style.getPropertyValue(name).trim())
  })()`
  await browser.load({ url: `${withEngine('native')}&scale=1.3&tilt=-4&stagger=120` })
  const tuned = await browser.evaluate<string[]>(knobs)
  await browser.load({ url: `${withEngine('native')}&scale=9&tilt=abc&stagger=-5` })
  const ignored = await browser.evaluate<string[]>(knobs)
  assert.deepEqual(
    { tuned, ignored },
    { tuned: ['1.3', '-4deg', '120ms'], ignored: ['1.14', '-2.5deg', '90ms'] },
  )
})
