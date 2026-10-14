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

const frames = () =>
  browser.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  )

/** Each part as `class: land, how much of it shows (0 to 1), and the opacity it shows with`. */
const STATES = `(() => {
    // As an IntersectionObserver sees it: inside the screen, and a card inside its row, which
    // scrolls sideways and clips what lies past its edges.
    const seen = (el) => {
      const r = el.getBoundingClientRect()
      const row = el.closest('.ab-strip-row')?.getBoundingClientRect()
      const [top, bottom] = [Math.max(r.top, 0, row?.top ?? 0), Math.min(r.bottom, innerHeight, row?.bottom ?? Infinity)]
      const [left, right] = [Math.max(r.left, 0, row?.left ?? 0), Math.min(r.right, innerWidth, row?.right ?? Infinity)]
      const shown = Math.max(0, bottom - top) * Math.max(0, right - left)
      return r.width && r.height ? shown / (r.width * r.height) : 0
    }
    // What fades while a part waits: the part, or the card in a list item, or a heading's effect.
    const face = (el) => el.matches('.ab-strip-item') ? el.firstElementChild : el.matches('.ab-sfx') ? el.lastElementChild : el
    return ${PARTS}.map((el) => ({
      name: el.className.split(' ')[0],
      land: el.dataset.land,
      shown: Math.round(seen(el) * 100) / 100,
      opacity: Number(getComputedStyle(face(el)).opacity),
      // A transform or an opacity left inline, as a GSAP slam sets them (native sets none).
      inline: [el, ...el.querySelectorAll('*')].some((e) => e.style.transform || e.style.opacity),
    }))
  })()`
type PartState = { name: string; land: string; shown: number; opacity: number; inline: boolean }
const partStates = () => browser.evaluate<PartState[]>(STATES)

/**
 * Waits, frame by frame, up to `ms`, for no part 15% or more on screen to be waiting, and returns
 * the ones still waiting then. Both engines get the same grace: GSAP batches what scrolls in.
 */
const waitingAfter = (ms: number) =>
  browser.evaluate<PartState[]>(`new Promise((resolve) => {
    const since = performance.now()
    const look = () => {
      const waiting = ${STATES}.filter((p) => p.land === 'wait' && p.shown >= 0.15)
      if (!waiting.length || performance.now() - since > ${ms}) resolve(waiting)
      else requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })`)

for (const engine of ENGINES) {
  test(`with ${engine}, parts below the first screen wait, see-through, and none waits once 15% of it shows`, async () => {
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    await frames()
    const atLoad = (await partStates()).filter((p) => p.shown === 0)
    const notWaiting = atLoad.filter((p) => p.land !== 'wait' || p.opacity !== 0)
    // Down the whole page in 150px steps: nothing 15% or more on screen may still be waiting
    // 200ms later, the most either engine is given to start a part's slam.
    const waiting: string[] = []
    const end = await browser.evaluate<number>(
      'document.documentElement.scrollHeight - innerHeight',
    )
    for (let y = 0; y <= end; y += 150) {
      await browser.evaluate(`scrollTo(0, ${y}); true`)
      for (const p of await waitingAfter(200)) waiting.push(`${y}px: ${p.name} (${p.shown})`)
    }
    // Once their slams have played, the parts that landed show in full and play nothing more.
    // Done is the engine's own word for it: animationsDone() can't see GSAP's tweens.
    assert.ok(
      await browser.waitFor(`!document.querySelector('[data-land="go"]')`, 5_000),
      'parts still landing 5s later',
    )
    const unlanded = (await partStates()).filter(
      (p) => p.shown >= 0.15 && (p.land !== 'done' || p.opacity !== 1 || p.inline),
    )
    assert.ok(atLoad.length > 10, 'nothing below the first screen to check')
    assert.deepEqual(
      { notWaiting, waiting, unlanded },
      { notWaiting: [], waiting: [], unlanded: [] },
    )
  })

  test(`with ${engine}, Tab lands a waiting part at once, never see-through or mid-slam`, async () => {
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    // Tab until the focus is in a part (the first trending panel, below the first screen).
    let met: { land: string; moving: number; opacity: number } | null = null
    for (let i = 0; i < 40 && !met; i++) {
      await browser.press('Tab')
      met = await browser.evaluate(`(() => {
        const part = document.activeElement.closest('[data-land]')
        if (!part) return null
        // Mid-slam: a slam or entrance keyframe still running (native), or a transform or an
        // opacity still set inline (GSAP). Focus has effects of its own, such as speed lines.
        const slams = ${JSON.stringify([...ENTRANCES, 'ab-panel-slam', 'ab-machine-drop'])}
        const inline = [part, ...part.querySelectorAll('*')].filter((el) => el.style.transform || el.style.opacity)
        return {
          land: part.dataset.land,
          moving: part.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && slams.includes(a.animationName)).length + inline.length,
          opacity: Number(getComputedStyle(part).opacity),
        }
      })()`)
    }
    assert.deepEqual(met, { land: 'done', moving: 0, opacity: 1 })
  })
}
