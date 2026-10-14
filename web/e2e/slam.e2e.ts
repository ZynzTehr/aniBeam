// Draft PR 3 (phase-2-proto-scroll, never merged): the scroll-slam prototype, with each engine
// (see src/slam/switch.ts). Its own file, so the engines' pages stay in a profile of their own.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
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
      // A slam or entrance keyframe still running (native). Focus has effects of its own.
      moving: el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && ${JSON.stringify(['ab-ink', 'ab-settle', 'ab-pop', 'ab-boom', 'ab-panel-slam', 'ab-machine-drop'])}.includes(a.animationName)).length,
    }))
  })()`
type PartState = {
  name: string
  land: string
  shown: number
  opacity: number
  inline: boolean
  moving: number
}
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

// The keyframes a slam or a load-time entrance plays (native).
const SLAMS = [...ENTRANCES, 'ab-panel-slam', 'ab-machine-drop']

/**
 * Scrolls down the whole page in 150px steps (or up, from the bottom), giving each step up to
 * `settle` ms for the parts that came into view to start landing, then calling `each`.
 */
async function scrollDown({
  up = false,
  settle = 200,
  each,
}: { up?: boolean; settle?: number; each?: (y: number) => Promise<unknown> } = {}) {
  const end = await browser.evaluate<number>('document.documentElement.scrollHeight - innerHeight')
  const steps: number[] = []
  for (let y = 0; y <= end; y += 150) steps.push(y)
  for (const y of up ? steps.reverse() : steps) {
    await browser.evaluate(`scrollTo(0, ${y}); true`)
    if (settle) await waitingAfter(settle)
    await each?.(y)
  }
}

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

  test(`with ${engine}, 48 Tabs from the top never meet a waiting or mid-slam part`, async () => {
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    const met: string[] = []
    let reached = 0
    for (let i = 1; i <= 48; i++) {
      await browser.press('Tab')
      const part = await browser.evaluate<PartState | null>(
        `(() => { const part = document.activeElement.closest('[data-land]'); return part && ${STATES}[${PARTS}.indexOf(part)] })()`,
      )
      if (!part) continue
      reached++
      if (part.land !== 'done' || part.opacity !== 1 || part.moving || part.inline)
        met.push(`Tab ${i}: ${part.name}, ${part.land}, opacity ${part.opacity}`)
    }
    assert.ok(reached >= 20, `Tab reached only ${reached} parts`)
    assert.deepEqual(met, [], 'parts Tab met waiting, see-through or mid-slam')
  })

  test(`with ${engine}, scrolling down, up and down again replays nothing, and neither does a moved panel`, async () => {
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    await scrollDown()
    assert.ok(await browser.waitFor(`!document.querySelector('[data-land="go"]')`, 5_000))
    // From here on, note any slam that starts again: a slam keyframe (native), a part leaving
    // done, or a transform or an opacity set inline on a part or what it holds (GSAP).
    await browser.evaluate(`(() => {
      window.__replays = []
      const slams = ${JSON.stringify(SLAMS)}
      document.addEventListener('animationstart', (event) => {
        if (slams.includes(event.animationName)) window.__replays.push(event.animationName + ' on ' + event.target.className)
      }, true)
      new MutationObserver((records) => {
        for (const { target, attributeName } of records) {
          if (attributeName === 'data-land' && target.dataset.land !== 'done') window.__replays.push('back to ' + target.dataset.land)
          if (attributeName === 'style' && target.closest('[data-land]') && (target.style.transform || target.style.opacity)) window.__replays.push('inline style on ' + target.className)
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-land', 'style'] })
      return true
    })()`)
    await scrollDown({ up: true })
    await scrollDown()
    // React reorders keyed panels by moving them, which restarts their CSS animations.
    await browser.evaluate(`(() => {
      const grid = document.querySelector('.ab-grid:not([aria-hidden])')
      grid.prepend(grid.lastElementChild)
      return true
    })()`)
    await frames()
    await sleep(300)
    assert.deepEqual(await browser.evaluate('window.__replays'), [], 'slams that played again')
  })

  test(`with ${engine}, reduced motion, from the device or the site's switch, hides nothing and moves nothing`, async () => {
    const still = `${STATES}.filter((p) => p.opacity !== 1 || p.moving || p.inline).map((p) => p.name + ': ' + p.land + ', opacity ' + p.opacity)`
    // The device asks from the start: every part shows, all the way down.
    await browser.load({ url: withEngine(engine), reduceMotion: true })
    assert.ok(await browser.titlesShown())
    const device: string[] = []
    await scrollDown({
      each: async (y) =>
        device.push(...(await browser.evaluate<string[]>(still)).map((p) => `${y}px: ${p}`)),
    })
    // The site's switch, turned on mid-slam: whatever was waiting or landing shows, still.
    await browser.load({ url: withEngine(engine) })
    assert.ok(await browser.titlesShown())
    let site: string[] = []
    try {
      await browser.evaluate(`document.getElementById('ab-trending').scrollIntoView(); true`)
      await browser.evaluate('new Promise((resolve) => setTimeout(() => resolve(true), 150))')
      await browser.evaluate(`document.getElementById('reduce-motion').click(); true`)
      await frames()
      site = await browser.evaluate<string[]>(still)
    } finally {
      await browser.evaluate(
        `localStorage.removeItem('anibeam:motion'); delete document.documentElement.dataset.motion; true`,
      )
    }
    assert.deepEqual({ device, site }, { device: [], site: [] })
  })

  test(`with ${engine}, no part's box moves while it lands, and the page shifts less than 0.1`, async (t) => {
    // A slam may move only transform and opacity, which leave the layout alone. Chrome's layout
    // shifts can't show that by themselves: they skip the few pixels a smooth animation moves a
    // frame. So, frame by frame, each landing part's own box (and its card or effect's) must stay
    // where it was laid out: offsetTop and the rest ignore transforms.
    const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__shifts = []
        new PerformanceObserver((list) => window.__shifts.push(...list.getEntries())).observe({ type: 'layout-shift', buffered: true })
        window.__moved = []
        const boxes = new WeakMap()
        const box = (el) => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight].join(' ')
        requestAnimationFrame(function look() {
          for (const part of document.querySelectorAll('[data-land="go"]'))
            for (const el of [part, part.firstElementChild, part.lastElementChild]) {
              if (!el) continue
              const now = box(el), then = boxes.get(el)
              if (then && then !== now) window.__moved.push(part.className.split(' ')[0] + ': ' + then + ' to ' + now)
              boxes.set(el, now)
            }
          requestAnimationFrame(look)
        })`,
    })
    try {
      await browser.load({ url: withEngine(engine) })
      assert.ok(await browser.titlesShown())
      await scrollDown()
      await browser.waitFor(`!document.querySelector('[data-land="go"]')`, 5_000)
      // Every shift added up, from the start of the load: stricter than CLS's busiest window.
      const { shifted, moved } = await browser.evaluate<{ shifted: number; moved: string[] }>(
        '({ shifted: window.__shifts.reduce((sum, shift) => sum + shift.value, 0), moved: [...new Set(window.__moved)].slice(0, 6) })',
      )
      t.diagnostic(`layout shift while scrolling, ${engine}: ${shifted.toFixed(4)}`)
      assert.deepEqual(moved, [], 'parts whose box moved while they landed')
      assert.ok(shifted < 0.1, `the page shifted ${shifted.toFixed(4)}`)
    } finally {
      await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    }
  })

  test(`with ${engine}, on a phone nothing overflows sideways, even mid-slam`, async () => {
    await browser.load({ url: withEngine(engine), width: 390, height: 844, phone: true })
    assert.ok(await browser.titlesShown())
    const wide: string[] = []
    // The widest the page gets, frame by frame, for 300ms after each step, while the parts that
    // came into view slam in (from 1.14 times their size, by default).
    await scrollDown({
      settle: 0,
      each: async (y) => {
        const width = await browser.evaluate<number>(`new Promise((resolve) => {
          let widest = 0
          const since = performance.now()
          const look = () => {
            widest = Math.max(widest, innerWidth === 390 ? document.documentElement.scrollWidth : innerWidth)
            if (performance.now() - since > 300) resolve(widest)
            else requestAnimationFrame(look)
          }
          requestAnimationFrame(look)
        })`)
        if (width > 390) wide.push(`${y}px: ${width}px wide`)
      },
    })
    assert.deepEqual(wide, [], 'the page wider than the phone')
  })
}
