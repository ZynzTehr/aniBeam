// The scroll slam: parts of the page that land once, as they scroll into view (see
// src/lib/landing.ts and the Landing section of components.css). Spec §3J and DESIGN.md.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { LANDING_PARTS, LINGER_MS } from '../src/lib/landing.ts'
import { Browser } from './browser.ts'

let browser: Browser
before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

// Each check fails on an uncaught exception, or a console error or warning, from the page while it
// ran (see Browser.problems).
let problemsBefore = 0
beforeEach(() => {
  problemsBefore = browser.problems.length
})
afterEach(() => {
  assert.deepEqual(browser.problems.slice(problemsBefore), [], 'the page reported problems')
})

const PARTS = `[...document.querySelectorAll(${JSON.stringify(LANDING_PARTS)})]`
// The keyframes of a slam, and of the page's load-time entrances, which a part must not play at
// load as well.
const ENTRANCES = ['ab-ink', 'ab-settle', 'ab-pop', 'ab-boom']
const SLAMS = [...ENTRANCES, 'ab-panel-slam', 'ab-machine-drop']

/** Each part as its place, how it stands, how much of it shows (0 to 1) and how see-through. */
const STATES = `(() => {
  // As an IntersectionObserver sees it: the part of it inside the screen, and a card inside its row,
  // which scrolls sideways and clips what lies past its edges.
  const seen = (el) => {
    const r = el.getBoundingClientRect()
    const row = el.closest('.ab-strip-row')?.getBoundingClientRect()
    const [top, bottom] = [Math.max(r.top, 0, row?.top ?? 0), Math.min(r.bottom, innerHeight, row?.bottom ?? Infinity)]
    const [left, right] = [Math.max(r.left, 0, row?.left ?? 0), Math.min(r.right, innerWidth, row?.right ?? Infinity)]
    const shown = Math.max(0, bottom - top) * Math.max(0, right - left)
    return r.width && r.height ? shown / (r.width * r.height) : 0
  }
  // What a part shows itself with: a panel or the machine itself, the card in a list item, a
  // heading's sound effect.
  const face = (el) => (el.matches('.ab-strip-item') ? el.firstElementChild : el.matches('.ab-sfx') ? el.lastElementChild : el)
  const name = (el) =>
    el.matches('.ab-sfx') ? 'heading "' + el.firstChild.textContent.trim() + '"'
    : el.matches('.ab-machine') ? 'the machine'
    : (el.matches('.ab-strip-item') ? 'card ' : 'panel ') + ([...el.parentElement.children].indexOf(el) + 1)
  return ${PARTS}.map((el) => ({
    name: name(el),
    land: el.dataset.land,
    shown: Math.round(seen(el) * 100) / 100,
    opacity: Number(getComputedStyle(face(el)).opacity),
    moving: el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && ${JSON.stringify(SLAMS)}.includes(a.animationName)).length,
  }))
})()`
type PartState = { name: string; land: string; shown: number; opacity: number; moving: number }
const partStates = () => browser.evaluate<PartState[]>(STATES)

const frames = () =>
  browser.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  )

/**
 * Waits, frame by frame, up to `ms`, for no part 15% or more on screen to be waiting, and returns
 * the ones still waiting then.
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

/**
 * Scrolls down the whole page in 150px steps (or up, from the foot), giving each step up to
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

/** Resolves once no part is landing: each has played its slam, or never began it. */
const landed = () => browser.waitFor(`!document.querySelector('[data-land="go"]')`, 5_000)

test('a part below the first screen waits, see-through, and lands as 15% of it shows, with its slam played once', async () => {
  // The slam itself: each part's own slam (a panel's, a card's pop, the machine's drop, a heading's
  // boom) starts once, as the part lands, not at load.
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__slams = new Map()
      addEventListener('animationstart', (event) => {
        const { animationName: slam, target } = event
        const own = slam === 'ab-panel-slam' || slam === 'ab-machine-drop' ? target
          : (slam === 'ab-pop' && target.matches('.ab-strip-item > .ab-strip-panel')) || (slam === 'ab-boom' && target.matches('.ab-sfx > span')) ? target.parentElement
          : null
        if (own) window.__slams.set(own, (window.__slams.get(own) ?? 0) + 1)
      }, true)`,
  })
  await browser.load()
  assert.ok(await browser.titlesShown())
  await frames()
  const atLoad = (await partStates()).filter((p) => p.shown === 0)
  const notWaiting = atLoad.filter((p) => p.land !== 'wait' || p.opacity !== 0 || p.moving)
  // Down the whole page in 150px steps: nothing 15% or more on screen may still wait 200ms later.
  const waiting: string[] = []
  await scrollDown({
    settle: 0,
    each: async (y) => {
      for (const p of await waitingAfter(200)) waiting.push(`${y}px: ${p.name} (${p.shown})`)
    },
  })
  assert.ok(await landed(), 'parts still landing 5s later')
  // Every part that landed shows in full, still; the rest are cards past a row's edge, still
  // waiting to be scrolled to.
  const states = await partStates()
  const unlanded = states.filter(
    (p) =>
      (p.land === 'done' && (p.opacity !== 1 || p.moving)) ||
      (p.land !== 'done' && !(p.land === 'wait' && p.name.startsWith('card'))),
  )
  const slams = await browser.evaluate<number[]>(
    `${PARTS}.map((part) => window.__slams.get(part) ?? 0)`,
  )
  await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  assert.ok(atLoad.length >= 6, `only ${atLoad.length} parts below the first screen to check`)
  assert.deepEqual(
    { notWaiting, waiting, unlanded, slams },
    {
      notWaiting: [],
      waiting: [],
      unlanded: [],
      slams: states.map((p) => (p.land === 'done' ? 1 : 0)),
    },
  )
})

test('a decade card past its row’s edge waits until scrolled to, then lands, and none on screen waits', async () => {
  // The cards that came into view with the strip land with it; the rest wait past the row's edge,
  // and land as the row is scrolled sideways to them, in 150px steps.
  await browser.load()
  assert.ok(await browser.titlesShown())
  await browser.evaluate(
    `document.getElementById('decades').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
  )
  await waitingAfter(200)
  // Once what landed has played: a load-time entrance can hold a card see-through for a while too.
  await browser.animationsDone()
  const cards = async () => (await partStates()).filter((p) => p.name.startsWith('card'))
  const pastEdge = (await cards()).filter((p) => p.shown === 0)
  const notWaiting = pastEdge.filter((p) => p.land !== 'wait' || p.opacity !== 0)
  const waiting: string[] = []
  const end = await browser.evaluate<number>(
    `(() => { const row = document.querySelector('.ab-strip-row:not([aria-hidden])'); return row.scrollWidth - row.clientWidth })()`,
  )
  for (let x = 0; x <= end + 150; x += 150) {
    await browser.evaluate(
      `document.querySelector('.ab-strip-row:not([aria-hidden])').scrollTo({ left: ${x}, behavior: 'instant' }); true`,
    )
    for (const p of await waitingAfter(200)) waiting.push(`${x}px along: ${p.name} (${p.shown})`)
  }
  assert.ok(await landed(), 'cards still landing 5s later')
  const unlanded = (await cards()).filter((p) => p.land !== 'done' || p.opacity !== 1)
  assert.ok(pastEdge.length >= 5, `only ${pastEdge.length} cards past the row's edge to check`)
  assert.deepEqual({ notWaiting, waiting, unlanded }, { notWaiting: [], waiting: [], unlanded: [] })
})

test('content arriving above the visitor while a part slams in leaves the visitor’s place', async () => {
  // Chrome keeps what the visitor looks at in place as content arrives above it, by scrolling the
  // page as much (scroll anchoring), as when a search's late answer takes the intro's place. A part
  // mid-slam must not stop that: the pull machine's drop did, and the page jumped by what arrived.
  // So the screen is scrolled to start 50px into the machine, where Chrome takes what to keep in
  // place, and while it lands, 300px arrive at the top of the page: the page must scroll by just
  // that.
  await browser.load()
  assert.ok(await browser.titlesShown())
  const moved = await browser.evaluate<string>(`new Promise((resolve) => {
    const machine = document.querySelector('.ab-machine')
    scrollTo({ top: machine.getBoundingClientRect().top + scrollY + 50, behavior: 'instant' })
    const frame = () => new Promise((next) => requestAnimationFrame(next))
    ;(async () => {
      for (let i = 0; i < 10 && machine.dataset.land !== 'go'; i++) await frame()
      if (machine.dataset.land !== 'go') return resolve('the machine never landed: ' + machine.dataset.land)
      await frame()
      const before = scrollY
      document.querySelector('main').prepend(Object.assign(document.createElement('div'), { style: 'height: 300px' }))
      await frame()
      await frame()
      resolve('scrolled ' + Math.round(scrollY - before) + 'px for 300px arriving above, the machine ' + machine.dataset.land)
    })()
  })`)
  assert.equal(moved, 'scrolled 300px for 300px arriving above, the machine go')
})

test('a part peeking in by less than 15% lands once it has stayed in view a moment, and one passed over doesn’t', async () => {
  // A part that shows by a sliver, then leaves the screen at once, still waits: from the top of the
  // page, a waiting part below the screen shows by 8% for two frames. But at rest with the decades
  // at the top of a 1440x900 screen, the row's last card in view peeks in by about a tenth: it
  // shows the row goes on sideways, so it lands once it has stayed 0.2s (LINGER_MS).
  await browser.load()
  assert.ok(await browser.titlesShown())
  const passed = await browser.evaluate<string>(`new Promise((resolve) => {
    const frame = () => new Promise((next) => requestAnimationFrame(next))
    const part = ${PARTS}.find((el) => el.dataset.land === 'wait' && el.getBoundingClientRect().top > innerHeight)
    if (!part) return resolve('no waiting part below the screen')
    ;(async () => {
      const at = scrollY
      scrollTo({ top: part.getBoundingClientRect().top + scrollY - innerHeight + part.offsetHeight * 0.08, behavior: 'instant' })
      await frame()
      await frame()
      scrollTo({ top: at, behavior: 'instant' })
      await new Promise((next) => setTimeout(next, 500))
      resolve(part.dataset.land)
    })()
  })`)
  await browser.evaluate(
    `document.getElementById('decades').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
  )
  await frames()
  const peeking = (await partStates()).filter((p) => p.shown > 0 && p.shown < 0.15)
  await sleep(LINGER_MS + 100)
  assert.ok(await landed(), 'parts still landing 5s later')
  const after = await partStates()
  const stayed = peeking.map((p) => {
    const now = after.find((q) => q.name === p.name)
    return `${p.name}: ${now?.land}, opacity ${now?.opacity}`
  })
  assert.ok(peeking.length > 0, 'no part peeking in at the screen’s edge to check')
  assert.deepEqual(
    { passed, stayed },
    { passed: 'wait', stayed: peeking.map((p) => `${p.name}: done, opacity 1`) },
  )
})

test('a heading reached by a header link or an intro button booms as it takes focus', async () => {
  // Section headings take focus only from these links (they are out of the Tab order): a jump to
  // one lands it as if seen, so its sound effect booms there, rather than at once, as Tab lands
  // what it reaches.
  const booms: Record<string, string> = {}
  for (const [from, label] of [
    ['.ab-nav a', 'Trending'],
    ['.ab-nav a', 'Pull'],
    ['.ab-nav a', 'Decades'],
    ['.ab-intro-actions a', 'Browse by decade'],
  ]) {
    await browser.load()
    assert.ok(await browser.titlesShown())
    await browser.evaluate(`(() => {
      window.__booms = []
      addEventListener('animationstart', (event) => {
        if (event.animationName === 'ab-boom' && event.target.matches('.ab-sfx > span')) window.__booms.push(event.target.parentElement.id)
      }, true)
      ;[...document.querySelectorAll(${JSON.stringify(from)})].find((link) => link.textContent.trim() === ${JSON.stringify(label)}).focus()
      return true
    })()`)
    await browser.press('Enter')
    // The boom starts as the heading lands, a frame or more after the jump, later on a cold page.
    await browser.waitFor(`window.__booms.includes(document.activeElement.id)`, 2_000)
    booms[label] = await browser.evaluate<string>(
      `(document.activeElement.matches('.ab-sfx') ? '#' + document.activeElement.id : 'focus elsewhere') + ', ' + (window.__booms.includes(document.activeElement.id) ? 'boomed' : 'no boom')`,
    )
  }
  assert.deepEqual(booms, {
    Trending: '#ab-trending, boomed',
    Pull: '#pull, boomed',
    Decades: '#decades, boomed',
    'Browse by decade': '#decades, boomed',
  })
})

test('48 Tabs straight after load never meet a part waiting or mid-slam, on a desktop or a phone', async () => {
  // Keyboard focus lands a part at once: whole, still and in place, however soon the visitor
  // Tabs, and whether the part was waiting or already landing (see landing.ts). PR 7's Tab walk
  // looks at each stop once the page has settled; this one starts at once.
  const met: string[] = []
  for (const screen of [
    { width: 1440, height: 900 },
    { width: 390, height: 844, phone: true },
  ]) {
    await browser.load(screen)
    assert.ok(await browser.titlesShown())
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    let reached = 0
    for (let i = 1; i <= 48; i++) {
      await browser.press('Tab')
      const part = await browser.evaluate<PartState | null>(
        `(() => { const part = document.activeElement.closest('[data-land]'); return part && ${STATES}[${PARTS}.indexOf(part)] })()`,
      )
      if (!part) continue
      reached++
      if (part.land !== 'done' || part.opacity !== 1 || part.moving)
        met.push(
          `${screen.width}px, Tab ${i}: ${part.name}, ${part.land}, opacity ${part.opacity}${part.moving ? ', moving' : ''}`,
        )
    }
    assert.ok(reached >= 20, `${screen.width}px: Tab reached only ${reached} parts`)
  }
  assert.deepEqual(met, [], 'parts Tab met waiting, see-through or mid-slam')
})

test('printed, every part shows, whether it has landed or not', async () => {
  // Waiting is for the screen: a printed page has no scrolling to land a part by.
  await browser.load()
  assert.ok(await browser.titlesShown())
  const motion = [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  let printed: PartState[] = []
  try {
    await browser.send('Emulation.setEmulatedMedia', { media: 'print', features: motion })
    await frames()
    printed = await partStates()
  } finally {
    await browser.send('Emulation.setEmulatedMedia', { media: '', features: motion })
  }
  const waiting = printed.filter((p) => p.land === 'wait')
  assert.ok(waiting.length >= 6, `only ${waiting.length} parts waiting to print`)
  assert.deepEqual(
    printed.filter((p) => p.opacity !== 1).map((p) => `${p.name}: ${p.land}, opacity ${p.opacity}`),
    [],
    'parts missing from the printed page',
  )
})

test('every part is marked as it arrives, on load and with new titles, and plays no load-time entrance', async () => {
  const unclaimed = () =>
    browser.evaluate<{ unmarked: string[]; entering: string[] }>(`(() => {
      const parts = ${PARTS}
      const name = (el) => el.className
      return {
        unmarked: parts.filter((el) => !el.dataset.land).map(name),
        entering: parts.filter((el) => el.dataset.land !== 'go' && el.getAnimations({ subtree: true }).some((a) => ${JSON.stringify(ENTRANCES)}.includes(a.animationName))).map(name),
      }
    })()`)
  await browser.forget()
  await browser.holdAniList(2500)
  try {
    // A first visit, slow: the empty panels give way to the titles as they come.
    await browser.load()
    assert.ok(await browser.titlesShown())
  } finally {
    await browser.holdAniList(0)
  }
  await frames()
  const onArrival = await unclaimed()
  assert.deepEqual(onArrival, { unmarked: [], entering: [] })
})

test('scrolling down, up and down again replays nothing, and neither does a moved panel', async () => {
  await browser.load()
  assert.ok(await browser.titlesShown())
  await scrollDown()
  assert.ok(await landed(), 'parts still landing 5s later')
  // From here on, note any slam that starts again on a part that has landed, or a part that leaves
  // done (cards past a row's edge still wait, unseen).
  await browser.evaluate(`(() => {
    window.__replays = []
    const slams = ${JSON.stringify(SLAMS)}
    const landed = new Set(document.querySelectorAll('[data-land="done"]'))
    document.addEventListener('animationstart', (event) => {
      if (slams.includes(event.animationName) && landed.has(event.target.closest('[data-land]'))) window.__replays.push(event.animationName + ' on ' + event.target.className)
    }, true)
    new MutationObserver((records) => {
      for (const { target, oldValue } of records)
        if (oldValue === 'done' && target.dataset.land !== 'done') window.__replays.push('back to ' + target.dataset.land)
    }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-land'] })
    return true
  })()`)
  await scrollDown({ up: true })
  await scrollDown()
  // React reorders keyed panels by moving them, as a refresh does, which restarts any animation.
  await browser.evaluate(`(() => {
    const grid = document.querySelector('.ab-grid:not([aria-hidden])')
    grid.prepend(grid.lastElementChild)
    return true
  })()`)
  await frames()
  await sleep(300)
  assert.deepEqual(await browser.evaluate('window.__replays'), [], 'slams that played again')
})

test('reduced motion, from the device or the site’s switch, hides nothing and moves nothing', async () => {
  const still = `${STATES}.filter((p) => p.opacity !== 1 || p.moving).map((p) => p.name + ': ' + p.land + ', opacity ' + p.opacity)`
  // The device asks from the start: every part shows, all the way down.
  await browser.load({ reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const device: string[] = []
  await scrollDown({
    each: async (y) =>
      device.push(...(await browser.evaluate<string[]>(still)).map((p) => `${y}px: ${p}`)),
  })
  // The site's switch, turned on mid-slam: whatever was waiting or landing shows, still.
  await browser.load()
  assert.ok(await browser.titlesShown())
  let site: string[] = []
  try {
    await browser.evaluate(`document.getElementById('ab-trending').scrollIntoView(); true`)
    await sleep(150)
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

test('no part’s box moves while it lands, and scrolling the whole page shifts it less than 0.1', async (t) => {
  // A slam may move only transform and opacity, which leave the layout alone. Chrome's layout
  // shifts can't show that by themselves: they skip the few pixels a smooth animation moves a
  // frame. So, frame by frame, each landing part's own box must stay where it was laid out:
  // offsetTop and the rest ignore transforms.
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__shifts = []
      new PerformanceObserver((list) => window.__shifts.push(...list.getEntries())).observe({ type: 'layout-shift', buffered: true })
      window.__moved = []
      const boxes = new WeakMap()
      const box = (el) => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight].join(' ')
      requestAnimationFrame(function look() {
        for (const part of document.querySelectorAll('[data-land="go"]')) {
          const now = box(part), then = boxes.get(part)
          if (then && then !== now) window.__moved.push(part.className + ': ' + then + ' to ' + now)
          boxes.set(part, now)
        }
        requestAnimationFrame(look)
      })`,
  })
  try {
    await browser.load()
    assert.ok(await browser.titlesShown())
    await scrollDown()
    await landed()
    // Every shift added up, from the start of the load: stricter than CLS's busiest window.
    const { shifted, moved } = await browser.evaluate<{ shifted: number; moved: string[] }>(
      '({ shifted: window.__shifts.reduce((sum, shift) => sum + shift.value, 0), moved: [...new Set(window.__moved)].slice(0, 6) })',
    )
    t.diagnostic(`layout shift while scrolling: ${shifted.toFixed(4)}`)
    assert.deepEqual(moved, [], 'parts whose box moved while they landed')
    assert.ok(shifted < 0.1, `the page shifted ${shifted.toFixed(4)}`)
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  }
})

test('on a phone nothing overflows sideways, even mid-slam', async () => {
  await browser.load({ width: 390, height: 844, phone: true })
  assert.ok(await browser.titlesShown())
  const wide: string[] = []
  // The widest the page gets, frame by frame, for 300ms after each step, while the parts that
  // came into view slam in (from 1.14 times their size).
  await scrollDown({
    settle: 0,
    each: async (y) => {
      const width = await browser.evaluate<number>(`new Promise((resolve) => {
        let widest = 0
        const since = performance.now()
        const look = () => {
          widest = Math.max(widest, document.documentElement.scrollWidth)
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
