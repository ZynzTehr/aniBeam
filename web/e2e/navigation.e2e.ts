// The page's section links (spec §5): the intro's three buttons, which fly into the header as it
// reaches them, and the header's links, which mark the section the visitor is in.
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { BASE_URL, Browser } from './browser.ts'

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

const DESKTOP = { width: 1440, height: 900 }

// Each of the intro's buttons: its label, fill and text color.
const BUTTONS = `[...document.querySelectorAll('.ab-intro-actions .ab-btn')].map((b) => {
  const style = getComputedStyle(b)
  return { label: b.textContent.trim(), fill: style.backgroundColor, text: style.color }
})`

/** Moves the mouse to the middle of what `selector` finds, as a visitor pointing at it would. */
async function pointAt(selector: string) {
  const { x, y } = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  return { x, y }
}

test('the intro’s three buttons share one look, and each turns ink as it is hovered or pressed', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const white = 'rgb(255, 255, 255)'
  const ink = 'rgb(20, 20, 20)'
  assert.deepEqual(
    (await browser.evaluate<{ label: string; fill: string; text: string }[]>(BUTTONS)).map(
      ({ fill, text }) => ({ fill, text }),
    ),
    [1, 2, 3].map(() => ({ fill: white, text: ink })),
    'at rest',
  )
  for (const n of [1, 2, 3]) {
    const button = `.ab-intro-actions .ab-btn:nth-child(${n})`
    await pointAt(button)
    const hovered = await browser.evaluate<{ fill: string; text: string }>(
      `(({ backgroundColor, color }) => ({ fill: backgroundColor, text: color }))(getComputedStyle(document.querySelector('${button}')))`,
    )
    assert.deepEqual(hovered, { fill: ink, text: white }, `button ${n} hovered`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890 })
  }
  // Pressed, as on a touch screen, where nothing is hovered: the page's rule for it. (Pressed with
  // a mouse, a button is hovered too; moved away while held, a link starts being dragged.)
  const pressed = await browser.evaluate<string[]>(`[...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules] } catch { return [] }
  }).flatMap(function rules(rule) { return [rule, ...[...(rule.cssRules ?? [])].flatMap(rules)] })
    .filter((rule) => rule.selectorText?.split(',').some((s) => s.trim() === '.ab-intro-actions .ab-btn:active'))
    .map((rule) => rule.style.getPropertyValue('background') + ' / ' + rule.style.color)`)
  assert.deepEqual(pressed, ['var(--ink) / rgb(255, 255, 255)'], 'the rule for a pressed button')
})

// The header's link marked as the section the visitor is in, by its address, or '' with none.
const CURRENT = `[...document.querySelectorAll('.ab-nav a[aria-current="location"]')].map((a) => a.getAttribute('href')).join(' ')`
const frames = () =>
  browser.evaluate(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
  )

test('the header marks the section the visitor is in, one at a time, and none above the first', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  assert.equal(await browser.evaluate(CURRENT), '', 'at the top')
  for (const id of ['ab-trending', 'pull', 'decades']) {
    await browser.evaluate(
      `document.getElementById('${id}').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
    )
    await frames()
    assert.equal(await browser.evaluate(CURRENT), `#${id}`, `scrolled to #${id}`)
  }
  await browser.evaluate(`scrollTo(0, 0); true`)
  await frames()
  assert.equal(await browser.evaluate(CURRENT), '', 'back at the top')
})

test('the current section’s link is yellow and raised, turns ink when hovered, and leaves the header its size', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const size = `(() => { const n = document.querySelector('.ab-nav').getBoundingClientRect(); return [document.querySelector('.ab-top').offsetHeight, n.left, n.top, n.width, n.height].map(Math.round).join(' ') })()`
  const before = await browser.evaluate<string>(size)
  await browser.evaluate(
    `document.getElementById('pull').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
  )
  await frames()
  const look = `(({ backgroundColor, color, boxShadow, transform }) => ({ fill: backgroundColor, text: color, shadow: boxShadow, transform }))(getComputedStyle(document.querySelector('.ab-nav a[href="#pull"]')))`
  assert.deepEqual(await browser.evaluate(look), {
    fill: 'rgb(255, 212, 0)',
    text: 'rgb(20, 20, 20)',
    shadow: 'rgb(20, 20, 20) 3px 3px 0px 0px',
    transform: 'matrix(1, 0, 0, 1, -2, -2)',
  })
  assert.equal(await browser.evaluate<string>(size), before, 'the header changed size')
  await pointAt('.ab-nav a[href="#pull"]')
  const hovered = await browser.evaluate<{ fill: string; text: string }>(look)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890 })
  assert.deepEqual(
    { fill: hovered.fill, text: hovered.text },
    { fill: 'rgb(20, 20, 20)', text: 'rgb(255, 255, 255)' },
    'hovered',
  )
})

test('at the end of the page the last section is current, and while searching, a section once it is well in view', async () => {
  await browser.load({ width: 1440, height: 2560, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.evaluate(`scrollTo(0, document.documentElement.scrollHeight); true`)
  await frames()
  assert.equal(await browser.evaluate(CURRENT), '#decades', 'at the end of the page')
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.search('frieren')
  assert.ok(
    await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`, 10_000),
  )
  await frames()
  assert.equal(await browser.evaluate(CURRENT), '', 'over the results')
  await browser.evaluate(
    `document.getElementById('ab-trending').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
  )
  await frames()
  assert.equal(await browser.evaluate(CURRENT), '#ab-trending', 'scrolled down to trending')
})

// Which set of section links shows (data-links, see lib/sectionNav.ts), and whether each is drawn.
const SHOWN = `(() => {
  const shown = (el) => Boolean(el) && getComputedStyle(el).visibility === 'visible'
  return {
    links: document.querySelector('.ab-app').dataset.links ?? 'none',
    header: [...document.querySelectorAll('.ab-top .ab-nav a')].every(shown),
    intro: shown(document.querySelector('.ab-intro-actions')),
  }
})()`
// Where the intro's buttons are laid out on the page, and the header's bottom: a fraction of a
// pixel with text spacing (137.19px, say), which the page compares with as it is.
const GEOMETRY = `(() => {
  let top = 0
  for (let el = document.querySelector('.ab-intro-actions'); el; el = el.offsetParent) top += el.offsetTop
  return { top, bottom: document.querySelector('.ab-top').getBoundingClientRect().bottom }
})()`
// The scroll at which the intro's buttons reach the header's bottom.
const DOCK_AT = `(({ top, bottom }) => top - Math.floor(bottom))(${GEOMETRY})`
const scrollAndSettle = async (y: number | string) => {
  await browser.evaluate(`scrollTo(0, ${y}); true`)
  await frames()
}
const TEXT_SPACING = `(() => {
  const style = document.head.appendChild(document.createElement('style'))
  style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
  return true
})()`

test('from 900px the header’s links wait hidden until the intro’s buttons reach the header, and swap back 200px later', async () => {
  for (const [screen, spacing] of [
    [DESKTOP, false],
    [{ width: 1024, height: 600 }, false],
    [{ width: 960, height: 900 }, true],
  ] as const) {
    const at = `${screen.width}px${spacing ? ', text spacing' : ''}`
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    if (spacing) {
      await browser.evaluate(TEXT_SPACING)
      await frames()
    }
    assert.deepEqual(
      await browser.evaluate(SHOWN),
      { links: 'intro', header: false, intro: true },
      `${at}, at the top`,
    )
    const dockAt = await browser.evaluate<number>(DOCK_AT)
    await scrollAndSettle(dockAt - 1)
    assert.equal(
      (await browser.evaluate<{ links: string }>(SHOWN)).links,
      'intro',
      `${at}, a pixel short`,
    )
    await scrollAndSettle(dockAt)
    assert.deepEqual(
      await browser.evaluate(SHOWN),
      { links: 'header', header: true, intro: false },
      `${at}, docked`,
    )
    // They swap back once their place is 200px below the header, or, on a screen too short for
    // that, where it is at the top of the page.
    const { top, bottom } = await browser.evaluate<{ top: number; bottom: number }>(GEOMETRY)
    const gap = Math.min(200, top - bottom)
    const undockAt = top - Math.ceil(bottom + gap)
    const links = async () => (await browser.evaluate<{ links: string }>(SHOWN)).links
    if (undockAt < dockAt - 100) {
      await scrollAndSettle(dockAt - 100)
      assert.equal(await links(), 'header', `${at}, 100px back up`)
    }
    if (undockAt > 0) {
      await scrollAndSettle(undockAt + 1)
      assert.equal(await links(), 'header', `${at}, a pixel short of the gap`)
    }
    await scrollAndSettle(Math.max(0, undockAt))
    assert.equal(await links(), 'intro', `${at}, at the gap`)
    await scrollAndSettle(dockAt + 300)
    await scrollAndSettle(0)
    assert.equal(
      (await browser.evaluate<{ links: string }>(SHOWN)).links,
      'intro',
      `${at}, back at the top`,
    )
  }
})

test('swapping the links moves nothing: the header, its links and the intro’s buttons keep their place and size', async () => {
  const boxes = `(() => {
    const box = (el) => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight].join(',')
    return [document.querySelector('.ab-top').offsetHeight, getComputedStyle(document.documentElement).getPropertyValue('--top-h'),
      ...[...document.querySelectorAll('.ab-top .ab-nav a, .ab-top .ab-soon, .ab-intro-actions .ab-btn')].map(box)].join(' | ')
  })()`
  for (const [screen, spacing] of [
    [DESKTOP, false],
    [{ width: 960, height: 900 }, true],
  ] as const) {
    await browser.watchLayoutShifts()
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await browser.landAll()
    if (spacing) {
      await browser.evaluate(TEXT_SPACING)
      await frames()
    }
    const before = await browser.evaluate<string>(boxes)
    const shiftBefore = (await browser.layoutShift()).value
    const dockAt = await browser.evaluate<number>(DOCK_AT)
    for (const y of [dockAt + 10, 0, dockAt + 10, 0]) {
      await scrollAndSettle(y)
      assert.equal(
        await browser.evaluate<string>(boxes),
        before,
        `${screen.width}px at ${y}: something moved`,
      )
    }
    assert.equal(
      (await browser.layoutShift()).value,
      shiftBefore,
      `${screen.width}px: a layout shift`,
    )
  }
})

test('one set of section links shows at a time, to the mouse, the keyboard and screen readers', async () => {
  // Each link to the three sections that is drawn: hidden ones can't be reached or read.
  const drawn = `[...document.querySelectorAll('a[href="#ab-trending"], a[href="#pull"], a[href="#decades"]')].filter((a) => a.checkVisibility({ visibilityProperty: true })).map((a) => a.getAttribute('href')).sort().join(' ')`
  const all = '#ab-trending #decades #pull'
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  assert.equal(await browser.evaluate(drawn), all, 'at the top')
  await scrollAndSettle(await browser.evaluate<number>(DOCK_AT))
  assert.equal(await browser.evaluate(drawn), all, 'docked')
  await scrollAndSettle(0)
  await browser.search('frieren')
  assert.ok(
    await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`, 10_000),
  )
  assert.equal(await browser.evaluate(drawn), all, 'while searching')
})

test('while searching, the header’s links show, and clearing the search at the top brings the intro’s buttons back with nothing moved', async () => {
  await browser.watchLayoutShifts()
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.search('frieren')
  assert.ok(
    await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`, 10_000),
  )
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'header', header: true, intro: false },
    'while searching',
  )
  const shift = (await browser.layoutShift()).value
  await browser.search('')
  assert.ok(await browser.waitFor(`document.querySelector('.ab-intro-actions')`, 5000))
  await frames()
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'intro', header: false, intro: true },
    'cleared',
  )
  assert.ok(
    (await browser.layoutShift()).value - shift < 0.01,
    'clearing the search moved the page',
  )
})

test('a reload partway down the page shows the header’s links from the first frame drawn there', async () => {
  // Each frame's scroll and set, from the page's first moment.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__frames = []; (function record() { const app = document.querySelector('.ab-app'); window.__frames.push([scrollY, app ? app.dataset.links ?? 'none' : 'no app']); if (window.__frames.length < 120) requestAnimationFrame(record) })()`,
  })
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const dockAt = await browser.evaluate<number>(DOCK_AT)
  await scrollAndSettle(dockAt + 600)
  await browser.evaluate(`window.__beforeReload = true; true`)
  await browser.send('Page.reload')
  await browser.waitFor(`!window.__beforeReload && window.__frames.length >= 60`, 10_000)
  const recorded = await browser.evaluate<[number, string][]>(`window.__frames`)
  assert.ok(
    recorded.some(([y]) => y >= dockAt + 10),
    'no frame was drawn partway down: the reload didn’t restore the scroll in time',
  )
  const wrong = recorded.filter(([y, links]) => y >= dockAt + 10 && links !== 'header')
  assert.deepEqual(wrong, [], 'frames past the buttons without the header’s links')
})

test('a link that has focus never hides: the set holding it stays until focus leaves', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  const dockAt = await browser.evaluate<number>(DOCK_AT)
  // An intro button with focus, scrolled past the header.
  await browser.evaluate(
    `document.querySelector('.ab-intro-actions a[href="#pull"]').focus({ preventScroll: true }); true`,
  )
  await scrollAndSettle(dockAt + 300)
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'intro', header: false, intro: true },
    'an intro button focused',
  )
  await browser.evaluate(`document.activeElement.blur(); true`)
  await frames()
  assert.equal((await browser.evaluate<{ links: string }>(SHOWN)).links, 'header', 'once it left')
  // A header link with focus, scrolled back to the top.
  await browser.evaluate(
    `document.querySelector('.ab-nav a[href="#pull"]').focus({ preventScroll: true }); true`,
  )
  await scrollAndSettle(0)
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'header', header: true, intro: false },
    'a header link focused',
  )
  await browser.evaluate(`document.activeElement.blur(); true`)
  await frames()
  assert.equal((await browser.evaluate<{ links: string }>(SHOWN)).links, 'intro', 'once it left')
})

test('under 900px neither the header’s section links nor the intro’s buttons are drawn, at the top, at the end or while searching; the header keeps its size', async () => {
  // The menu holds the links there (see the phone menu's checks below). The intro's buttons stay
  // in the page, for the dock from 900px.
  const drawn = `({
    header: document.querySelector('.ab-top .ab-nav').checkVisibility(),
    intro: document.querySelector('.ab-intro-actions')?.checkVisibility() ?? 'no intro',
  })`
  const header = `(() => { const top = document.querySelector('.ab-top'); return [top.offsetHeight, getComputedStyle(top).position].join(' ') })()`
  for (const screen of [
    { width: 390, height: 844, phone: true },
    { width: 768, height: 1024, phone: true },
    { width: 860, height: 900 },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    assert.deepEqual(
      await browser.evaluate(drawn),
      { header: false, intro: false },
      `${screen.width}px, at the top`,
    )
    assert.ok(
      await browser.evaluate(
        `Boolean(document.querySelector('.ab-intro-actions a[href="#pull"]'))`,
      ),
      `${screen.width}px: the intro’s buttons left the page`,
    )
    const atTop = await browser.evaluate<string>(header)
    await scrollAndSettle('document.documentElement.scrollHeight')
    assert.deepEqual(
      await browser.evaluate(drawn),
      { header: false, intro: false },
      `${screen.width}px, at the end`,
    )
    await scrollAndSettle(0)
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`, 10_000),
    )
    assert.deepEqual(
      await browser.evaluate(drawn),
      { header: false, intro: 'no intro' },
      `${screen.width}px, searching`,
    )
    assert.equal(
      await browser.evaluate<string>(header),
      atTop,
      `${screen.width}px: the header changed`,
    )
    assert.equal(
      atTop,
      '78 sticky',
      `${screen.width}px: the header isn’t one row that stays on the screen`,
    )
  }
})

test('in the gallery, which has no intro, the header’s links all show', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true, url: new URL('/?gallery', BASE_URL).href })
  assert.ok(await browser.waitFor(`document.querySelector('.ab-top .ab-nav a')`, 10_000))
  assert.equal(
    await browser.evaluate(
      `[...document.querySelectorAll('.ab-top .ab-nav a')].every((a) => getComputedStyle(a).visibility === 'visible')`,
    ),
    true,
  )
})

// Pauses the flight's animations, so that a check sees the page end it, not its own landing.
const PAUSE_FLIGHT = `document.getAnimations().filter((a) => a.effect?.target?.closest?.('.ab-flight')).forEach((a) => a.pause()); true`
// What is left of a flight, paused or not: its animations and its copies.
const FLIGHT_LEFT = `document.getAnimations().filter((a) => a.effect?.target?.closest?.('.ab-flight')).length + document.querySelectorAll('.ab-flight-chip').length`
// The flight's animations under way: where each runs, its timing, and what its keyframes change.
const FLIGHT_NOW = `document.getAnimations().filter((a) => a.effect?.target?.closest?.('.ab-flight') && a.playState === 'running').map((a) => {
  const t = a.effect.getTiming()
  return { on: a.effect.target.className, duration: t.duration, delay: t.delay, easing: t.easing,
    changes: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))))].join(',') }
})`

test('with motion allowed, the intro’s buttons fly into the header as a scroll brings it to them, and back down, landing in place', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  const dockAt = await browser.evaluate<number>(DOCK_AT)
  // Where each copy is drawn to land, against where the link it lands as is.
  const landing = `[...document.querySelectorAll('.ab-flight-chip')].map((chip, i) => {
    const link = document.querySelectorAll(${JSON.stringify('.ab-top .ab-nav a[href^="#"]')})[i]
    const to = link.getBoundingClientRect(), offset = getComputedStyle(document.querySelector('.ab-flight')).position === 'absolute' ? [scrollX, scrollY] : [0, 0]
    return [parseFloat(chip.style.left) - offset[0] - to.left, parseFloat(chip.style.top) - offset[1] - to.top, parseFloat(chip.style.width) - to.width].map((d) => Math.abs(d) < 1)
  }).flat().every(Boolean)`
  await browser.evaluate(`scrollTo(0, ${dockAt}); true`)
  await frames()
  const mid = await browser.evaluate<{
    links: string
    hidden: boolean
    inert: boolean
    current: boolean
  }>(`({
    links: document.querySelector('.ab-app').dataset.links,
    hidden: document.querySelector('.ab-flight').getAttribute('aria-hidden') === 'true',
    inert: document.querySelector('.ab-flight').inert,
    current: document.querySelector('.ab-flight-chip .ab-flight-pill').classList.contains('is-current'),
  })`)
  assert.deepEqual(mid, { links: 'none', hidden: true, inert: true, current: true }, 'mid-flight')
  assert.equal(await browser.evaluate(landing), true, 'the copies don’t land on the header’s links')
  const flying =
    await browser.evaluate<
      { on: string; duration: number; delay: number; easing: string; changes: string }[]
    >(FLIGHT_NOW)
  assert.deepEqual(
    [
      ...new Set(
        flying
          .filter((a) => a.on === 'ab-flight-chip')
          .map((a) => `${a.duration} ${a.delay} ${a.easing}`),
      ),
    ],
    [
      '420 0 cubic-bezier(0.2, 1.35, 0.35, 1)',
      '420 45 cubic-bezier(0.2, 1.35, 0.35, 1)',
      '420 90 cubic-bezier(0.2, 1.35, 0.35, 1)',
    ],
  )
  // Transforms and opacity, and the clip that keeps the labels inside the pill, on their box only.
  assert.deepEqual([...new Set(flying.map((a) => a.changes))].sort(), [
    'clipPath',
    'opacity',
    'transform',
  ])
  assert.deepEqual(
    [...new Set(flying.filter((a) => a.changes === 'clipPath').map((a) => a.on))],
    ['ab-flight-text'],
  )
  await browser.animationsDone()
  await frames()
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'header', header: true, intro: false },
    'landed',
  )
  assert.equal(await browser.evaluate(`document.querySelectorAll('.ab-flight-chip').length`), 0)
  // And back down, onto the intro's buttons, drawn on the page.
  const { top, bottom } = await browser.evaluate<{ top: number; bottom: number }>(GEOMETRY)
  await browser.evaluate(
    `scrollTo(0, ${top - Math.ceil(bottom + Math.min(200, top - bottom))}); true`,
  )
  await frames()
  const back = `[...document.querySelectorAll('.ab-flight-chip')].map((chip, i) => {
    const to = document.querySelectorAll('.ab-intro-actions a')[i].getBoundingClientRect()
    return Math.abs(parseFloat(chip.style.left) - scrollX - to.left) < 1 && Math.abs(parseFloat(chip.style.top) - scrollY - to.top) < 1
  })`
  assert.deepEqual(
    await browser.evaluate(back),
    [true, true, true],
    'the copies don’t land on the intro’s buttons',
  )
  await browser.animationsDone()
  await frames()
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'intro', header: false, intro: true },
    'back down',
  )
})

test('under reduced motion, from the device or the site’s switch, the sets swap at once, with no flight', async () => {
  for (const how of ['device', 'switch']) {
    await browser.load({ ...DESKTOP, reduceMotion: how === 'device' })
    assert.ok(await browser.titlesShown())
    await browser.landAll()
    if (how === 'switch')
      await browser.evaluate(`document.getElementById('reduce-motion').click(); true`)
    try {
      await browser.animationsDone()
      await browser.evaluate(`scrollTo(0, ${await browser.evaluate<number>(DOCK_AT)}); true`)
      await frames()
      assert.deepEqual(await browser.evaluate(FLIGHT_NOW), [], `${how}: a flight`)
      assert.equal(
        (await browser.evaluate<{ links: string }>(SHOWN)).links,
        'header',
        `${how}: not swapped`,
      )
    } finally {
      // The switch's choice is saved for later visits: off again for the checks after this one,
      // whatever happened.
      if (how === 'switch')
        await browser.evaluate(`document.getElementById('reduce-motion').click(); true`)
    }
  }
})

test('a flight cut short by the switch to reduce motion, or by Tab, lands at once', async () => {
  for (const how of ['switch', 'Tab']) {
    await browser.load(DESKTOP)
    assert.ok(await browser.titlesShown())
    await browser.landAll()
    await browser.animationsDone()
    await browser.evaluate(`scrollTo(0, ${await browser.evaluate<number>(DOCK_AT)}); true`)
    await frames()
    assert.ok(
      (await browser.evaluate<unknown[]>(FLIGHT_NOW)).length > 0,
      `${how}: no flight to cut short`,
    )
    if (how === 'switch')
      await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
    else await browser.press('Tab')
    await frames()
    assert.deepEqual(await browser.evaluate(FLIGHT_NOW), [], `${how}: still flying`)
    // Landed: a set shows again, the one the page is at (Tab to the skip link scrolls to the top).
    assert.notEqual(
      (await browser.evaluate<{ links: string }>(SHOWN)).links,
      'none',
      `${how}: not landed`,
    )
  }
})

test('a jump by an intro button swaps the sets at once, with no flight', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.animationsDone()
  await browser.evaluate(
    `document.querySelector('.ab-intro-actions a[href="#pull"]').click(); true`,
  )
  assert.ok(await browser.waitFor(`location.hash === '#pull'`, 5000))
  await frames()
  assert.deepEqual(await browser.evaluate(FLIGHT_NOW), [], 'a flight')
  assert.equal((await browser.evaluate<{ links: string }>(SHOWN)).links, 'header')
  assert.equal(await browser.evaluate(CURRENT), '#pull')
})

test('each flying copy’s shadow fades to the look it lands on, and a dock starts below the header, not over it', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  const dockAt = await browser.evaluate<number>(DOCK_AT)
  // Scrolled 30px past the line: the buttons are partly under the header as the flight starts.
  await browser.evaluate(`scrollTo(0, ${dockAt + 30}); true`)
  await frames()
  const flight = `(() => {
    const bottom = document.querySelector('.ab-top').getBoundingClientRect().bottom
    return [...document.querySelectorAll('.ab-flight-chip')].map((chip) => {
      const fade = chip.querySelector('.ab-flight-shadow').getAnimations().find((a) => a.effect.getKeyframes()[0].opacity !== undefined)
      const move = chip.getAnimations()[0].effect.getKeyframes()[0].transform
      const dy = parseFloat(/translate\\([^,]+,\\s*([-\\d.]+)px/.exec(move)[1])
      const top = parseFloat(chip.style.top), height = parseFloat(chip.style.height)
      return {
        shadow: fade.effect.getKeyframes().map((k) => Number(k.opacity)).join(' to '),
        current: chip.querySelector('.ab-flight-pill').classList.contains('is-current'),
        // Where the copy starts: its landing box moved by the first keyframe, its start height
        // the button's (a 48px button lands as a 44px link).
        startsBelow: top + height / 2 + dy - document.querySelector('.ab-intro-actions a').offsetHeight / 2 >= bottom - 0.5,
      }
    })
  })()`
  const docking =
    await browser.evaluate<{ shadow: string; current: boolean; startsBelow: boolean }[]>(flight)
  assert.equal(docking.length, 3, 'no flight')
  assert.deepEqual(
    docking.map(({ shadow, current }) => `${current ? 'current' : 'plain'}: ${shadow}`),
    ['current: 1 to 1', 'plain: 1 to 0', 'plain: 1 to 0'],
    'docking',
  )
  assert.deepEqual(
    docking.map(({ startsBelow }) => startsBelow),
    [true, true, true],
    'a copy started over the header',
  )
  await browser.animationsDone()
  const { top, bottom } = await browser.evaluate<{ top: number; bottom: number }>(GEOMETRY)
  await browser.evaluate(
    `scrollTo(0, ${top - Math.ceil(bottom + Math.min(200, top - bottom))}); true`,
  )
  await frames()
  const undocking = await browser.evaluate<{ shadow: string }[]>(flight)
  assert.deepEqual(
    undocking.map(({ shadow }) => shadow),
    ['1 to 1', '0 to 1', '0 to 1'],
    'undocking',
  )
})

test('a change of width lands a flight under way at once, and a change of height alone doesn’t', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  await browser.evaluate(`scrollTo(0, ${await browser.evaluate<number>(DOCK_AT)}); true`)
  await frames()
  assert.ok((await browser.evaluate<unknown[]>(FLIGHT_NOW)).length > 0, 'no flight')
  // Paused, so that only the page can end it, not its own landing.
  await browser.evaluate(PAUSE_FLIGHT)
  // A browser's toolbar hiding as the page scrolls: only the height changes.
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 840,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await frames()
  assert.ok((await browser.evaluate<number>(FLIGHT_LEFT)) > 0, 'a change of height landed it')
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 840,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await frames()
  assert.equal(await browser.evaluate(FLIGHT_LEFT), 0, 'narrowed, it is still flying')
  assert.notEqual(
    (await browser.evaluate<{ links: string }>(SHOWN)).links,
    'none',
    'narrowed, no set shows',
  )
})

test('in contrast themes the current section’s link takes the theme’s selection colors, and its focus ring the theme’s text color', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'forced-colors', value: 'active' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })
  try {
    await browser.evaluate(
      `document.getElementById('pull').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
    )
    await frames()
    // The theme's colors, as the page resolves them.
    const colors = `(() => {
      const probe = document.body.appendChild(document.createElement('div'))
      probe.style.cssText = 'forced-color-adjust: none; background: Highlight; color: CanvasText'
      const { backgroundColor, color } = getComputedStyle(probe)
      probe.remove()
      const style = (sel) => getComputedStyle(document.querySelector(sel))
      return {
        highlight: backgroundColor,
        text: color,
        current: style('.ab-nav a[aria-current="location"]').backgroundColor,
        other: style('.ab-nav a[href="#decades"]').backgroundColor,
      }
    })()`
    const seen = await browser.evaluate<{
      highlight: string
      text: string
      current: string
      other: string
    }>(colors)
    assert.equal(seen.current, seen.highlight, 'the current link’s fill')
    assert.notEqual(seen.other, seen.highlight, 'another link’s fill')
    // Reached from the keyboard: Shift+Tab from the Decades link.
    await browser.evaluate(`document.querySelector('.ab-nav a[href="#decades"]').focus(); true`)
    await browser.press('Tab', true)
    const ring = await browser.evaluate<{ name: string; outline: string }>(
      `({ name: document.activeElement.textContent, outline: getComputedStyle(document.activeElement).outlineColor })`,
    )
    assert.deepEqual(ring, { name: 'Pull', outline: seen.text }, 'its focus ring')
  } finally {
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'none' }],
    })
  }
})

test('a tap or click on a section link focuses its heading with no ring, even where the link takes no focus, and Enter with its ring', async () => {
  // Safari, and every browser on an iPhone, doesn't focus a link as it is tapped or clicked, and so
  // counts the heading's focus as the keyboard's; Chrome focuses the link, which hides the ring by
  // itself. So the click here is made as Safari makes it: the link's focus on mousedown cancelled.
  const safari = `document.addEventListener('mousedown', (e) => { if (e.target.closest('a')) e.preventDefault() }, true); true`
  // What has focus, and whether its ring shows: drawn behind it, or in contrast themes its outline.
  const ring = `(() => {
    const focused = document.activeElement
    return { id: focused.id, ring: focused.matches(':focus-visible') && getComputedStyle(focused, '::before').content !== 'none', outline: getComputedStyle(focused).outlineStyle }
  })()`
  for (const contrast of [false, true]) {
    await browser.load({ ...DESKTOP, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await browser.landAll()
    if (contrast)
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      })
    try {
      await browser.evaluate(safari)
      const { x, y } = await pointAt('.ab-intro-actions a[href="#decades"]')
      for (const type of ['mousePressed', 'mouseReleased'])
        await browser.send('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          clickCount: 1,
        })
      await frames()
      const seen = await browser.evaluate<{ id: string; ring: boolean; outline: string }>(ring)
      assert.deepEqual(
        contrast ? { id: seen.id, outline: seen.outline } : { id: seen.id, ring: seen.ring },
        contrast ? { id: 'decades', outline: 'none' } : { id: 'decades', ring: false },
        contrast ? 'clicked, in a contrast theme' : 'clicked',
      )
    } finally {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'forced-colors', value: 'none' }],
      })
    }
  }
  // From the keyboard: Enter on the intro's Pull button.
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.evaluate(
    `document.querySelector('.ab-intro-actions a[href="#pull"]').focus(); true`,
  )
  await browser.press('Enter')
  await frames()
  const keyed = await browser.evaluate<{ id: string; ring: boolean }>(ring)
  assert.deepEqual({ id: keyed.id, ring: keyed.ring }, { id: 'pull', ring: true }, 'Enter')
})

test('the intro’s buttons are the landmark named Sections, read only while they show; the header’s, which holds My List too, is Site; on a phone the menu’s are Sections', async () => {
  const landmarks = async () => {
    const { nodes } = await browser.send('Accessibility.getFullAXTree')
    return (nodes as { ignored: boolean; role?: { value: string }; name?: { value: string } }[])
      .filter((n) => !n.ignored && n.role?.value === 'navigation')
      .map((n) => n.name?.value)
      .sort()
  }
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  assert.deepEqual(await landmarks(), ['Sections', 'Site'], 'at the top')
  await scrollAndSettle(await browser.evaluate<number>(DOCK_AT))
  assert.deepEqual(await landmarks(), ['Site'], 'docked')
  // On a phone the links are in the menu: none is read until it opens, and then only its own,
  // inside the menu, the page behind it shut away.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await scrollAndSettle('document.documentElement.scrollHeight')
  assert.deepEqual(await landmarks(), [], 'a phone, at the end')
  await openMenuByKey()
  assert.deepEqual(await landmarks(), ['Sections'], 'a phone, the menu open')
  assert.ok(
    await browser.evaluate(
      `Boolean(document.querySelector('dialog.ab-drawer[open] nav[aria-label="Sections"]'))`,
    ),
    'the menu’s Sections aren’t inside the open menu',
  )
})

test('mid-flight both sets hide, each copy starts where it leaves, its labels cross the right way, and only a dock lands yellow', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  const dockAt = await browser.evaluate<number>(DOCK_AT)
  // Each copy: its labels' opacity at start and end, in the order the copy holds them (the
  // button's, then the link's), whether it is held at its start during its stagger, and its pill.
  const copies = `(() => ({
    layer: getComputedStyle(document.querySelector('.ab-flight')).position,
    hidden: [...document.querySelectorAll('.ab-top .ab-nav a, .ab-intro-actions')].every((el) => getComputedStyle(el).visibility === 'hidden'),
    copies: [...document.querySelectorAll('.ab-flight-chip')].map((chip) => ({
      labels: [...chip.querySelectorAll('.ab-flight-label')].map((label) => label.getAnimations()[0].effect.getKeyframes().map((k) => Number(k.opacity)).filter((o, i, all) => i === 0 || i === all.length - 1).join(' to ')),
      held: getComputedStyle(chip).transform !== 'none',
      yellow: chip.querySelector('.ab-flight-pill').classList.contains('is-current'),
    })),
  }))()`
  // The first frame after the scroll, read in the page with the flight paused there, so no time
  // passes between: the third copy's 90ms stagger hasn't run out, so it must wait at its start.
  const firstFrame = (y: number) =>
    browser.evaluate(
      `new Promise((resolve) => { scrollTo(0, ${y}); requestAnimationFrame(() => requestAnimationFrame(() => { ${PAUSE_FLIGHT}; resolve(true) })) })`,
    )
  await firstFrame(dockAt)
  const dock = await browser.evaluate<{
    layer: string
    hidden: boolean
    copies: { labels: string[]; held: boolean; yellow: boolean }[]
  }>(copies)
  assert.deepEqual(
    {
      layer: dock.layer,
      hidden: dock.hidden,
      labels: dock.copies.map((c) => c.labels.join(', ')),
      held: dock.copies.map((c) => c.held),
      yellow: dock.copies.map((c) => c.yellow),
    },
    {
      layer: 'fixed',
      hidden: true,
      labels: ['1 to 0, 0 to 1', '1 to 0, 0 to 1', '1 to 0, 0 to 1'],
      held: [true, true, true],
      yellow: [true, false, false],
    },
    'docking',
  )
  // Let the paused flight go, and land.
  await browser.evaluate(
    `document.getAnimations().filter((a) => a.effect?.target?.closest?.('.ab-flight')).forEach((a) => a.play()); true`,
  )
  await browser.animationsDone()
  await frames()
  const { top, bottom } = await browser.evaluate<{ top: number; bottom: number }>(GEOMETRY)
  await firstFrame(top - Math.ceil(bottom + Math.min(200, top - bottom)))
  const undock = await browser.evaluate<{
    layer: string
    hidden: boolean
    copies: { labels: string[]; yellow: boolean }[]
  }>(copies)
  assert.deepEqual(
    {
      layer: undock.layer,
      hidden: undock.hidden,
      labels: undock.copies.map((c) => c.labels.join(', ')),
      yellow: undock.copies.map((c) => c.yellow),
    },
    {
      layer: 'absolute',
      hidden: true,
      labels: ['0 to 1, 1 to 0', '0 to 1, 1 to 0', '0 to 1, 1 to 0'],
      yellow: [false, false, false],
    },
    'undocking',
  )
})

test('throughout a flight each copy’s label sits on its middle, shows only inside its pill, crosses with the other without a pile-up, and one landed early holds its look', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  // The paused flight stepped 20ms at a time from its start to just before the last copy lands
  // (all in one go in the page, so it can't land and go between steps), each step measured: what
  // shows of a label (its box, cut to its clip if it has one) must lie on the copy's middle and
  // within its pill, the labels' strengths add up to one at most, and a copy past its own end
  // shows the shadow it lands with.
  const stepped = `(() => {
    const animations = document.getAnimations().filter((a) => a.effect?.target?.closest?.('.ab-flight'))
    const end = Math.max(...animations.map((a) => a.effect.getComputedTiming().endTime))
    const problems = []
    const insetOf = (clip, box) => {
      if (!clip.startsWith('inset(')) return box
      const v = clip.slice(6).split(' round')[0].replace(')', '').trim().split(/\\s+/).map(parseFloat)
      const [t, r = t, b = t, l = r] = v
      return { left: box.left + l, right: box.right - r, top: box.top + t, bottom: box.bottom - b }
    }
    for (let t = 0; t < end; t += 20) {
      for (const a of animations) a.currentTime = t
      document.querySelectorAll('.ab-flight-chip').forEach((chip, i) => {
        const pill = chip.querySelector('.ab-flight-pill').getBoundingClientRect()
        const middle = pill.left + pill.width / 2
        const clipper = chip.querySelector('.ab-flight-text')
        const clip = clipper ? insetOf(getComputedStyle(clipper).clipPath, clipper.getBoundingClientRect()) : null
        let strength = 0
        for (const label of chip.querySelectorAll('.ab-flight-label')) {
          const opacity = Number(getComputedStyle(label).opacity)
          strength += opacity
          if (opacity < 0.02) continue
          const box = label.getBoundingClientRect()
          const off = box.left + box.width / 2 - middle
          if (Math.abs(off) > 1.5) problems.push('t=' + t + ' copy ' + i + ': "' + label.textContent + '" ' + off.toFixed(1) + 'px off its middle')
          const left = clip ? Math.max(box.left, clip.left) : box.left
          const right = clip ? Math.min(box.right, clip.right) : box.right
          if (right > left && (left < pill.left - 0.5 || right > pill.right + 0.5)) problems.push('t=' + t + ' copy ' + i + ': "' + label.textContent + '" shows outside its pill')
        }
        if (strength > 1.02) problems.push('t=' + t + ' copy ' + i + ': labels at ' + strength.toFixed(2) + ' together')
        const shadow = chip.querySelector('.ab-flight-shadow')
        const fade = animations.find((a) => a.effect.target === shadow && a.effect.getKeyframes().some((k) => 'opacity' in k))
        const { endTime } = fade.effect.getComputedTiming()
        const last = Number(fade.effect.getKeyframes().at(-1).opacity)
        if (t >= endTime && Math.abs(Number(getComputedStyle(shadow).opacity) - last) > 0.02) problems.push('t=' + t + ' copy ' + i + ': landed, its shadow at ' + getComputedStyle(shadow).opacity + ', not ' + last)
      })
    }
    return problems
  })()`
  const firstFrame = (y: number) =>
    browser.evaluate(
      `new Promise((resolve) => { scrollTo(0, ${y}); requestAnimationFrame(() => requestAnimationFrame(() => { ${PAUSE_FLIGHT}; resolve(true) })) })`,
    )
  await firstFrame(await browser.evaluate<number>(DOCK_AT))
  assert.ok((await browser.evaluate<number>(FLIGHT_LEFT)) > 0, 'no dock')
  assert.deepEqual(await browser.evaluate<string[]>(stepped), [], 'docking')
  await browser.evaluate(
    `document.getAnimations().filter((a) => a.effect?.target?.closest?.('.ab-flight')).forEach((a) => a.play()); true`,
  )
  await browser.animationsDone()
  await frames()
  const { top, bottom } = await browser.evaluate<{ top: number; bottom: number }>(GEOMETRY)
  await firstFrame(top - Math.ceil(bottom + Math.min(200, top - bottom)))
  assert.ok((await browser.evaluate<number>(FLIGHT_LEFT)) > 0, 'no undock')
  assert.deepEqual(await browser.evaluate<string[]>(stepped), [], 'undocking')
})

test('focus moved mid-flight by a script lands the flight first', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  await browser.evaluate(`scrollTo(0, ${await browser.evaluate<number>(DOCK_AT)}); true`)
  await frames()
  assert.ok((await browser.evaluate<unknown[]>(FLIGHT_NOW)).length > 0, 'no flight')
  // Paused, so that only the page can end it, not its own landing.
  await browser.evaluate(PAUSE_FLIGHT)
  await browser.evaluate(`document.querySelector('.ab-search textarea').focus(); true`)
  await frames()
  assert.equal(await browser.evaluate(FLIGHT_LEFT), 0, 'still flying')
  assert.notEqual((await browser.evaluate<{ links: string }>(SHOWN)).links, 'none')
})

// ---------- Phones: one header row, and the menu that holds the section links ----------

const PHONE = { width: 390, height: 844, phone: true }

/** The middle of what `selector` finds, on the screen; a check fails if nothing matches. */
async function middleOf(selector: string) {
  const at = await browser.evaluate<{ x: number; y: number } | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const box = el.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })()`)
  if (!at) assert.fail(`nothing on the page is ${selector}`)
  return at
}

/** Clicks the middle of what `selector` finds with the mouse, as a visitor would. */
async function clickAt(selector: string) {
  const { x, y } = await middleOf(selector)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  for (const type of ['mousePressed', 'mouseReleased'])
    await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
}

/** A finger's tap at a point on the screen (with touch emulation on). */
async function tap(x: number, y: number) {
  await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const tapOn = async (selector: string) => {
  const { x, y } = await middleOf(selector)
  await tap(x, y)
}

const MENU_OPEN = `document.querySelector('.ab-drawer')?.open === true`
// Shut, and the menu button says so.
const MENU_SHUT = `!document.querySelector('.ab-drawer').open && document.querySelector('.ab-burger').getAttribute('aria-expanded') === 'false'`

/** Opens the phone menu with a click on its button, at the top of the page, and waits for it. */
async function openMenuByClick() {
  await clickAt('.ab-burger')
  assert.ok(await browser.waitFor(MENU_OPEN, 2000), 'the menu didn’t open')
}

/**
 * Opens the phone menu from the keyboard, wherever the page is: down the page a phone's header
 * can be hidden up the screen, where a click can't reach its button.
 */
async function openMenuByKey() {
  await browser.evaluate(
    `document.querySelector('.ab-burger').focus({ preventScroll: true }); true`,
  )
  await browser.press('Enter')
  assert.ok(await browser.waitFor(MENU_OPEN, 2000), 'the menu didn’t open')
}

// The text of what has focus, or of `el`, without what is drawn and not read (katakana).
const TEXT = `const text = (el) => { const copy = el.cloneNode(true); copy.querySelectorAll('[aria-hidden="true"], rt').forEach((n) => n.remove()); return copy.textContent.replace(/\\s+/g, ' ').trim() }`

test('under 900px the header is one 78px row: the menu button and AniBeam at the left, the search bubble at the right gutter, nothing overlapping or scrolling sideways', async () => {
  const row = `(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el || !el.checkVisibility()) return null
      const { left, right, top, bottom } = el.getBoundingClientRect()
      return { left, right, top, bottom }
    }
    const top = document.querySelector('.ab-top')
    const input = document.querySelector('.ab-search textarea')
    const style = getComputedStyle(input)
    const measure = document.createElement('canvas').getContext('2d')
    measure.font = style.font
    return {
      height: top.offsetHeight,
      gutter: parseFloat(getComputedStyle(top).paddingLeft),
      header: box('.ab-top'),
      burger: box('.ab-burger'),
      logo: box('.ab-logo'),
      bubble: box('.ab-bubble-field'),
      placeholder: input.placeholder,
      // Room for the placeholder in the box, against the placeholder's width in the box's font.
      room: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - measure.measureText(input.placeholder).width,
      sideways: document.documentElement.scrollWidth - innerWidth,
    }
  })()`
  type Box = { left: number; right: number; top: number; bottom: number }
  const searchName = async () => {
    const { nodes } = await browser.send('Accessibility.getFullAXTree')
    return (
      (nodes as { ignored: boolean; role?: { value: string }; name?: { value: string } }[])
        // A textarea, so it can wrap on a phone: a text box of more than one line.
        .filter((n) => !n.ignored && n.role?.value === 'textbox')
        .map((n) => n.name?.value)
    )
  }
  const problems: string[] = []
  for (const width of [320, 359, 360, 375, 390, 414, 430, 768, 899]) {
    await browser.load({ width, height: 844, phone: width < 768, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    const seen = await browser.evaluate<{
      height: number
      gutter: number
      header: Box
      burger: Box | null
      logo: Box
      bubble: Box
      placeholder: string
      room: number
      sideways: number
    }>(row)
    const at = `${width}px`
    const { header, burger, logo, bubble, gutter } = seen
    if (seen.height !== 78) problems.push(`${at}: the header is ${seen.height}px tall, not one row`)
    if (!burger) {
      problems.push(`${at}: no menu button is drawn`)
      continue
    }
    if (Math.abs(burger.left - gutter) > 0.5)
      problems.push(
        `${at}: the menu button starts at ${burger.left}px, not at the ${gutter}px gutter`,
      )
    if (logo.left < burger.right + 4 || logo.left > burger.right + 12)
      problems.push(`${at}: AniBeam starts ${logo.left - burger.right}px after the menu button`)
    if (bubble.left < logo.right + 8)
      problems.push(`${at}: the search bubble starts ${bubble.left - logo.right}px after AniBeam`)
    if (Math.abs(bubble.right - (width - gutter)) > 0.5)
      problems.push(`${at}: the search bubble ends at ${bubble.right}px, not at the right gutter`)
    for (const [name, box] of [
      ['the menu button', burger],
      ['AniBeam', logo],
      ['the search bubble', bubble],
    ] as const)
      if (box.top < header.top || box.bottom > header.bottom - 4)
        problems.push(`${at}: ${name} sticks out of the header’s row`)
    const placeholder = width < 360 ? 'Search' : 'Search titles'
    if (seen.placeholder !== placeholder)
      problems.push(`${at}: the box says "${seen.placeholder}", not "${placeholder}"`)
    if (seen.room < 0) problems.push(`${at}: the placeholder is cut by ${-seen.room}px`)
    const names = await searchName()
    if (names.join() !== 'Search titles')
      problems.push(`${at}: the search box is read as ${JSON.stringify(names)}`)
    if (seen.sideways > 0) problems.push(`${at}: the page scrolls ${seen.sideways}px sideways`)
  }
  // From 900px the header keeps its links, and has no menu button.
  for (const width of [900, 1440]) {
    await browser.load({ width, height: 900, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    if (await browser.evaluate(`Boolean(document.querySelector('.ab-burger')?.checkVisibility())`))
      problems.push(`${width}px: the menu button is drawn`)
  }
  assert.deepEqual(problems, [], 'the phone header’s row')
})

test('on a phone the menu button opens the menu, a modal panel from the left with the three section links and My List, Soon, last, focus on the first link and the page held still', async () => {
  await browser.watchLayoutShifts()
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const button = `(() => {
    const b = document.querySelector('.ab-burger')
    return b && { name: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), popup: b.getAttribute('aria-haspopup') }
  })()`
  assert.deepEqual(
    await browser.evaluate(button),
    { name: 'Menu', expanded: 'false', controls: 'ab-menu', popup: 'dialog' },
    'the menu button, shut',
  )
  const shift = (await browser.layoutShift()).value
  await openMenuByClick()
  assert.equal(
    (await browser.evaluate<{ expanded: string }>(button)).expanded,
    'true',
    'the menu button, open',
  )
  const menu = await browser.evaluate(`(() => {
    ${TEXT}
    const dialog = document.querySelector('.ab-drawer')
    const panel = dialog.getBoundingClientRect()
    return {
      id: dialog.id,
      modal: dialog.matches(':modal'),
      left: Math.round(dialog.querySelector('.ab-drawer-page').getBoundingClientRect().left),
      right: Math.round(panel.right),
      top: Math.round(panel.top),
      height: Math.round(panel.height),
      items: [...dialog.querySelectorAll('nav > *')].map((el) => text(el) + (el.matches('a[href]') ? ' (a link)' : el.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : '')),
      soon: getComputedStyle(dialog.querySelector('.ab-soon')).borderTopStyle,
      focus: text(document.activeElement),
      ring: document.activeElement.matches(':focus-visible'),
      locked: getComputedStyle(document.body).overflow,
    }
  })()`)
  assert.deepEqual(menu, {
    id: 'ab-menu',
    modal: true,
    left: 0,
    right: 320,
    top: 0,
    height: 844,
    items: ['Trending (a link)', 'Pull (a link)', 'Decades (a link)', 'My List Soon (disabled)'],
    soon: 'dashed',
    focus: 'Trending',
    ring: false,
    locked: 'hidden',
  })
  const { nodes } = await browser.send('Accessibility.getFullAXTree')
  const dialogs = (
    nodes as { ignored: boolean; role?: { value: string }; name?: { value: string } }[]
  )
    .filter((n) => !n.ignored && n.role?.value === 'dialog')
    .map((n) => n.name?.value)
  assert.deepEqual(dialogs, ['Menu'], 'the menu, as screen readers name it')
  // A wheel and a finger's scroll over the dimmed page leave the page where it was.
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 370,
    y: 500,
    deltaX: 0,
    deltaY: 400,
  })
  await browser.send('Input.synthesizeScrollGesture', {
    x: 370,
    y: 700,
    yDistance: -400,
    speed: 2000,
    gestureSourceType: 'touch',
  })
  await frames()
  assert.equal(await browser.evaluate('scrollY'), 0, 'the page scrolled under the menu')
  await browser.press('Escape')
  assert.ok(await browser.waitFor(MENU_SHUT, 2000), 'Esc left the menu open')
  assert.equal((await browser.layoutShift()).value, shift, 'the menu moved the page')
})

test('on a phone the menu shuts on its X, on a tap on the dimmed page and on Esc, handing focus back to the menu button, with no ring after a tap, and the page where it was', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  try {
    const seen: Record<string, unknown> = {}
    for (const how of ['its X', 'a tap on the dimmed page', 'Esc']) {
      await scrollAndSettle(0)
      await tapOn('.ab-burger')
      assert.ok(await browser.waitFor(MENU_OPEN, 2000), `${how}: the menu didn’t open`)
      if (how === 'its X') await tapOn('.ab-drawer .ab-close')
      else if (how === 'Esc') await browser.press('Escape')
      else await tap(375, 600)
      await browser.waitFor(MENU_SHUT, 2000)
      await frames()
      seen[how] = await browser.evaluate(`({
        open: document.querySelector('.ab-drawer').open,
        expanded: document.querySelector('.ab-burger').getAttribute('aria-expanded'),
        focus: document.activeElement.getAttribute('aria-label'),
        ring: document.activeElement.matches(':focus-visible'),
        y: scrollY,
        locked: getComputedStyle(document.body).overflow === 'hidden',
      })`)
    }
    const shut = {
      open: false,
      expanded: 'false',
      focus: 'Menu',
      ring: false,
      y: 0,
      locked: false,
    }
    assert.deepEqual(seen, {
      'its X': shut,
      'a tap on the dimmed page': shut,
      // A key shut it: the button shows its ring, for the keyboard.
      Esc: { ...shut, ring: true },
    })
  } finally {
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  }
})

test('a tap on a menu link shuts the menu and lands its section 96px down, its heading focused with no ring; Enter on one keeps the ring', async () => {
  // What has focus, whether its ring shows (drawn behind a heading), and where the heading is.
  const landed = `(() => {
    const focused = document.activeElement
    const top = Math.round(focused.getBoundingClientRect().top)
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 1
    return {
      open: document.querySelector('.ab-drawer').open,
      focus: focused.id,
      ring: focused.matches(':focus-visible') && getComputedStyle(focused, '::before').content !== 'none',
      at: top === 96 ? '96px down' : atEnd && top > 96 ? '96px down or lower, at the end of the page' : top + 'px down',
      hash: location.hash,
    }
  })()`
  const seen: Record<string, unknown> = {}
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  try {
    for (const id of ['ab-trending', 'pull', 'decades']) {
      await browser.load({ ...PHONE, reduceMotion: true })
      assert.ok(await browser.titlesShown())
      await browser.landAll()
      await tapOn('.ab-burger')
      assert.ok(await browser.waitFor(MENU_OPEN, 2000), `#${id}: the menu didn’t open`)
      await tapOn(`.ab-drawer a[href="#${id}"]`)
      await browser.waitFor(`!(${MENU_OPEN}) && document.activeElement.id === '${id}'`, 2000)
      await frames()
      seen[id] = await browser.evaluate(landed)
    }
  } finally {
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  }
  const tapped = (id: string, at = '96px down') => ({
    open: false,
    focus: id,
    ring: false,
    at,
    hash: `#${id}`,
  })
  const decades = (seen.decades as { at?: string } | undefined)?.at
  assert.deepEqual(seen, {
    'ab-trending': tapped('ab-trending'),
    pull: tapped('pull'),
    // Decades, the last section, may be too near the page's end to come up that far.
    decades: tapped('decades', decades?.startsWith('96px down') ? decades : '96px down'),
  })
  // From the keyboard: Enter on the menu button opens it on its first link, with its ring, and
  // Enter on Pull jumps there, the heading with its ring.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.evaluate(`document.querySelector('.ab-burger').focus(); true`)
  await browser.press('Enter')
  assert.ok(await browser.waitFor(MENU_OPEN, 2000), 'Enter didn’t open the menu')
  assert.deepEqual(
    await browser.evaluate(
      `(() => { ${TEXT}; return { focus: text(document.activeElement), ring: document.activeElement.matches(':focus-visible') } })()`,
    ),
    { focus: 'Trending', ring: true },
    'opened with Enter',
  )
  await browser.press('Tab')
  await browser.press('Enter')
  await browser.waitFor(`!(${MENU_OPEN}) && document.activeElement.id === 'pull'`, 2000)
  await frames()
  const keyed = await browser.evaluate<{ focus: string; ring: boolean; open: boolean }>(landed)
  assert.deepEqual(
    { open: keyed.open, focus: keyed.focus, ring: keyed.ring },
    { open: false, focus: 'pull', ring: true },
    'Enter on Pull',
  )
})

test('the menu marks the section the visitor is in, in yellow, and opens on its link', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.evaluate(
    `document.getElementById('pull').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
  )
  await frames()
  await openMenuByKey()
  assert.deepEqual(
    await browser.evaluate(`(() => {
      const current = [...document.querySelectorAll('.ab-drawer a[aria-current="location"]')]
      return {
        current: current.map((a) => a.getAttribute('href')),
        fill: current[0] && getComputedStyle(current[0]).backgroundColor,
        others: [...document.querySelectorAll('.ab-drawer nav a:not([aria-current])')].map((a) => getComputedStyle(a).backgroundColor),
        focus: document.activeElement.getAttribute('href'),
      }
    })()`),
    {
      current: ['#pull'],
      fill: 'rgb(255, 212, 0)',
      others: ['rgb(255, 255, 255)', 'rgb(255, 255, 255)'],
      focus: '#pull',
    },
  )
})

test('with motion allowed the menu slides in from the left and back out; under reduced motion, the device’s or the site’s, it fades in and out in 150 ms without moving', async () => {
  // The menu's own transitions under way, of what moves it or fades it.
  const moving = `document.querySelector('.ab-drawer').getAnimations().filter((a) => ['transform', 'opacity'].includes(a.transitionProperty)).map((a) => a.transitionProperty + ' ' + a.effect.getTiming().duration).sort().join(', ')`
  const seen: Record<string, unknown> = {}
  for (const motion of ['allowed', 'reduced on the device', 'reduced on the site']) {
    await browser.load({ ...PHONE, reduceMotion: motion === 'reduced on the device' })
    assert.ok(await browser.titlesShown())
    if (motion === 'reduced on the site')
      await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
    await browser.animationsDone()
    await clickAt('.ab-burger')
    const opening = await browser.evaluate<string>(moving)
    await browser.waitFor(`document.querySelector('.ab-drawer').getAnimations().length === 0`, 2000)
    await browser.press('Escape')
    const closing = await browser.evaluate<string>(moving)
    await browser.waitFor(`document.querySelector('.ab-drawer').getAnimations().length === 0`, 2000)
    seen[motion] = { opening, closing }
  }
  const still = { opening: 'opacity 150', closing: 'opacity 150' }
  assert.deepEqual(seen, {
    allowed: { opening: 'transform 320', closing: 'transform 200' },
    'reduced on the device': still,
    'reduced on the site': still,
  })
})

test('in contrast themes the menu button and the menu keep their edges, and the menu marks the current link in the theme’s selection colors', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.evaluate(
    `document.getElementById('pull').scrollIntoView({ block: 'start', behavior: 'instant' }); true`,
  )
  await frames()
  await browser.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'forced-colors', value: 'active' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })
  try {
    await frames()
    const burger = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-burger')).borderTopStyle`,
    )
    await openMenuByKey()
    const seen = await browser.evaluate(`(() => {
      const probe = document.body.appendChild(document.createElement('div'))
      probe.style.cssText = 'forced-color-adjust: none; background: Highlight'
      const highlight = getComputedStyle(probe).backgroundColor
      probe.remove()
      const dialog = document.querySelector('.ab-drawer')
      const style = (sel) => getComputedStyle(dialog.querySelector(sel))
      return {
        edge: getComputedStyle(dialog).borderRightStyle,
        current: style('a[aria-current="location"]').backgroundColor === highlight,
        other: style('a[href="#decades"]').backgroundColor === highlight,
        links: [...dialog.querySelectorAll('nav > *')].map((el) => getComputedStyle(el).borderTopStyle),
        burst: getComputedStyle(dialog.querySelector('.ab-drawer-page'), '::after').content,
      }
    })()`)
    assert.deepEqual(
      { burger, ...(seen as object) },
      {
        burger: 'solid',
        edge: 'solid',
        current: true,
        other: false,
        links: ['solid', 'solid', 'solid', 'dashed'],
        burst: 'none',
      },
    )
  } finally {
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'none' }],
    })
  }
})

test('the menu shuts as the page widens to 900px, on Back, and as the address goes to a section', async () => {
  const shut = `({ open: document.querySelector('.ab-drawer').open, locked: getComputedStyle(document.body).overflow === 'hidden', expanded: document.querySelector('.ab-burger').getAttribute('aria-expanded') })`
  const seen: Record<string, unknown> = {}
  // Widened: the menu button is gone, so focus goes to the logo.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await openMenuByClick()
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await browser.waitFor(MENU_SHUT, 2000)
  seen.widened = {
    ...(await browser.evaluate<object>(shut)),
    focus: await browser.evaluate(`document.activeElement.className`),
  }
  // Back.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.evaluate(`history.pushState(history.state, '', location.href); true`)
  await openMenuByClick()
  await browser.evaluate(`history.back(); true`)
  await browser.waitFor(MENU_SHUT, 2000)
  seen.back = await browser.evaluate(shut)
  // A change of address to a section.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await openMenuByClick()
  await browser.evaluate(`location.hash = '#decades'; true`)
  await browser.waitFor(MENU_SHUT, 2000)
  seen.address = await browser.evaluate(shut)
  const closed = { open: false, locked: false, expanded: 'false' }
  assert.deepEqual(seen, {
    widened: { ...closed, focus: 'ab-logo' },
    back: closed,
    address: closed,
  })
})

// ---------- Phones: the menu's swipes ----------

/**
 * A finger's swipe through `path` ([x, y, ms] each: where it touches down, then each move), lifted
 * `hold` ms after the last. Each touch is stamped with its time, so the page reads the same speed
 * however fast the browser takes them: the last stamped now, the rest before it. `mid` runs at the
 * middle move, with the finger still down.
 */
async function swipe(path: [number, number, number][], { hold = 0, mid = async () => {} } = {}) {
  const end = path[path.length - 1][2] + hold
  const base = Date.now() / 1000 - end / 1000
  const point = ([x, y]: [number, number, number]) => [{ x, y }]
  await browser.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(path[0]),
    timestamp: base + path[0][2] / 1000,
  })
  for (let i = 1; i < path.length; i++) {
    await browser.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(path[i]),
      timestamp: base + path[i][2] / 1000,
    })
    if (i === Math.ceil((path.length - 1) / 2)) await mid()
  }
  await browser.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: base + end / 1000,
  })
}

/** A straight swipe from (x, y), `dx` across and `dy` down over `ms`, in `steps` even moves. */
const line = (x: number, y: number, dx: number, dy: number, ms: number, steps = 8) =>
  Array.from(
    { length: steps + 1 },
    (_, i) =>
      [x + (dx * i) / steps, y + (dy * i) / steps, (ms * i) / steps] as [number, number, number],
  )

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Turns on touch for the check, and off again after it, whatever happens. */
async function withTouch(check: () => Promise<void>) {
  await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  try {
    await check()
  } finally {
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  }
}

// The menu's state, what has focus and whether it shows its ring.
const MENU_STATE = `(() => {
  ${TEXT}
  return {
    open: document.querySelector('.ab-drawer').open,
    expanded: document.querySelector('.ab-burger').getAttribute('aria-expanded'),
    focus: document.activeElement === document.body ? 'the page' : document.activeElement.getAttribute('aria-label') ?? text(document.activeElement),
    ring: document.activeElement.matches(':focus-visible'),
  }
})()`
// How far across the menu's panel is drawn from where it rests, in whole pixels.
const PANEL_SHIFT = `Math.round(new DOMMatrix(getComputedStyle(document.querySelector('.ab-drawer')).transform).e)`

test('on a phone a rightward swipe that starts on the header row opens the menu, from the menu button, AniBeam or the air beside the search, far and slow or short and quick', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const header = await browser.evaluate<{
    y: number
    air: number
    logo: number
    burger: number
  }>(`(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect()
    const top = box('.ab-top')
    return {
      y: top.top + 39,
      air: (box('.ab-logo').right + box('.ab-bubble-field').left) / 2,
      logo: box('.ab-logo').left + box('.ab-logo').width / 2,
      burger: box('.ab-burger').left + box('.ab-burger').width / 2,
    }
  })()`)
  const { y } = header
  const seen: Record<string, unknown> = {}
  await withTouch(async () => {
    for (const [how, path] of [
      ['80px from the menu button, slowly', line(header.burger, y, 80, 0, 400)],
      ['80px from AniBeam, slowly', line(header.logo, y, 80, 0, 400)],
      ['80px from the air beside the search, slowly', line(header.air, y, 80, 0, 400)],
      ['a quick 30px flick from AniBeam', line(header.logo, y, 30, 0, 45, 3)],
    ] as const) {
      await swipe([...path])
      await browser.waitFor(MENU_OPEN, 1000)
      await frames()
      seen[how] = await browser.evaluate(MENU_STATE)
      await browser.evaluate(`document.querySelector('.ab-drawer').close(); true`)
      await browser.waitFor(MENU_SHUT, 1000)
      // Past the 500 ms in which a click is taken for the swipe's own.
      await sleep(550)
    }
  })
  // Opened by a finger: on the first link, with no ring.
  const opened = { open: true, expanded: 'true', focus: 'Trending', ring: false }
  assert.deepEqual(seen, {
    '80px from the menu button, slowly': opened,
    '80px from AniBeam, slowly': opened,
    '80px from the air beside the search, slowly': opened,
    'a quick 30px flick from AniBeam': opened,
  })
})

test('a swipe never opens the menu from the screen’s left edge, the search bubble, a short slow drag, a slant, a drag up the screen (which scrolls the page), below the header, with a mouse, or from 900px', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const at = await browser.evaluate<{ logo: number; bubble: number }>(`(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect()
    return { logo: box('.ab-logo').left + box('.ab-logo').width / 2, bubble: box('.ab-bubble-field').left + 20 }
  })()`)
  // The header's row leaves sideways drags to the page's script, and up and down drags and pinch
  // zoom to the browser; so does the menu.
  const touch = await browser.evaluate(
    `['.ab-top', '.ab-drawer'].map((sel) => getComputedStyle(document.querySelector(sel)).touchAction)`,
  )
  const seen: Record<string, unknown> = {}
  await withTouch(async () => {
    for (const [how, path] of [
      ['from 12px in', line(12, 39, 100, 0, 300)],
      ['from 22px in', line(22, 39, 100, 0, 300)],
      ['from the search bubble', line(at.bubble, 39, 100, 0, 300)],
      ['a slow 30px drag', line(at.logo, 39, 30, 0, 600)],
      ['a slant, 60px across and 40px down', line(at.logo, 20, 60, 40, 200)],
      ['a drag up the screen', line(at.logo, 70, 10, -60, 200)],
      ['below the header', line(100, 300, 100, 0, 300)],
    ] as const) {
      await scrollAndSettle(0)
      await swipe([...path])
      await sleep(300)
      seen[how] = {
        open: await browser.evaluate(MENU_OPEN),
        scrolled: (await browser.evaluate<number>('scrollY')) > 0,
      }
      await browser.evaluate(
        `document.querySelector('.ab-drawer').close(); document.activeElement.blur(); true`,
      )
    }
  })
  // A mouse drag across the air beside the search, as a laptop with a narrow window might make.
  // (From the air, not AniBeam: a mouse drags a link away, as a link to drop somewhere.)
  await scrollAndSettle(0)
  const air = await browser.evaluate<number>(
    `(document.querySelector('.ab-logo').getBoundingClientRect().right + document.querySelector('.ab-bubble-field').getBoundingClientRect().left) / 2`,
  )
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: air, y: 39 })
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: air,
    y: 39,
    button: 'left',
    clickCount: 1,
  })
  for (let i = 1; i <= 8; i++)
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: air + i * 10,
      y: 39,
      button: 'left',
      buttons: 1,
    })
  await browser.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: air + 80,
    y: 39,
    button: 'left',
    clickCount: 1,
  })
  await sleep(300)
  seen['with a mouse'] = { open: await browser.evaluate(MENU_OPEN), scrolled: false }
  // From 900px, where the header holds the links and no menu button.
  await browser.load({ width: 1024, height: 768, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await withTouch(async () => {
    await swipe(line(200, 40, 120, 0, 300))
    await sleep(300)
  })
  seen['at 1024px'] = { open: await browser.evaluate(MENU_OPEN), scrolled: false }
  const still = { open: false, scrolled: false }
  assert.deepEqual(
    { touch, ...seen },
    {
      touch: ['pan-y pinch-zoom', 'pan-y pinch-zoom'],
      'from 12px in': still,
      'from 22px in': still,
      'from the search bubble': still,
      'a slow 30px drag': still,
      'a slant, 60px across and 40px down': still,
      'a drag up the screen': { open: false, scrolled: true },
      'below the header': still,
      'with a mouse': still,
      'at 1024px': still,
    },
  )
})

test('a click straight after the swipe that opened the menu, where the finger lifted, does nothing; a tap a moment later works as ever', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const logo = await browser.evaluate<number>(
    `(({ left, width }) => left + width / 2)(document.querySelector('.ab-logo').getBoundingClientRect())`,
  )
  await browser.evaluate(`window.__beforeClick = true`)
  const seen: Record<string, unknown> = {}
  await withTouch(async () => {
    await swipe(line(logo, 39, 80, 0, 160))
    // Stands in for a click a browser may send where the finger lifted (Chrome sends none after a
    // finger that moved, so a check can't make one): on AniBeam, a link to the page's top.
    await browser.evaluate(`document.querySelector('.ab-logo').click(); true`)
    await sleep(300)
    seen.straight = {
      open: await browser.evaluate(MENU_OPEN),
      samePage: await browser.evaluate(`window.__beforeClick === true`),
    }
    await browser.evaluate(`document.querySelector('.ab-drawer').close(); true`)
    await sleep(600)
    await tapOn('.ab-burger')
    seen.later = { open: await browser.waitFor(MENU_OPEN, 1000) }
  })
  assert.deepEqual(seen, {
    straight: { open: true, samePage: true },
    later: { open: true },
  })
})

test('dragging the open menu left moves it with the finger, and only a little to the right; a short slow drag springs back, and past 30% of its width or on a quick flick it shuts, focus going back to the menu button with no ring', async () => {
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  const seen: Record<string, unknown> = {}
  const open = async () => {
    await tapOn('.ab-burger')
    assert.ok(await browser.waitFor(MENU_OPEN, 2000), 'the menu didn’t open')
    await browser.waitFor(`document.querySelector('.ab-drawer').getAnimations().length === 0`, 2000)
  }
  const settle = () =>
    browser.waitFor(`document.querySelector('.ab-drawer').getAnimations().length === 0`, 2000)
  await withTouch(async () => {
    // First, on the page as it loaded: opened by a swipe on the header, not a tap, then dragged
    // shut. No tap anywhere yet, and still no ring on the menu button.
    const logo = await browser.evaluate<number>(
      `(({ left, width }) => left + width / 2)(document.querySelector('.ab-logo').getBoundingClientRect())`,
    )
    await swipe(line(logo, 39, 80, 0, 400))
    assert.ok(await browser.waitFor(MENU_OPEN, 2000), 'the swipe didn’t open the menu')
    await settle()
    await swipe(line(250, 400, -120, 0, 800))
    await browser.waitFor(MENU_SHUT, 2000)
    await settle()
    await frames()
    seen['swiped open, dragged shut'] = await browser.evaluate(MENU_STATE)
    // Past the 500 ms in which a click is taken for the swipe's own.
    await sleep(550)
    await open()
    // Sampled halfway: 40px left of 80, then 50px right of 100.
    let left = 0
    let right = 0
    await swipe(line(250, 400, -80, 0, 800), {
      mid: async () => {
        await frames()
        left = await browser.evaluate<number>(PANEL_SHIFT)
      },
    })
    await settle()
    await swipe(line(150, 400, 100, 0, 400), {
      mid: async () => {
        await frames()
        right = await browser.evaluate<number>(PANEL_SHIFT)
      },
    })
    await settle()
    seen.following = {
      left,
      right: right > 0 && right < 30 ? 'a little' : right,
      open: await browser.evaluate(MENU_OPEN),
    }
    // 40px over 600 ms, let go: back where it rests.
    await swipe(line(250, 400, -40, 0, 600))
    await settle()
    seen['a short slow drag'] = {
      open: await browser.evaluate(MENU_OPEN),
      shift: await browser.evaluate(PANEL_SHIFT),
      drag: await browser.evaluate(
        `document.querySelector('.ab-drawer').style.getPropertyValue('--drag')`,
      ),
    }
    // Up and down in the panel: it stays.
    await swipe(line(200, 600, 5, -200, 300))
    await settle()
    seen['a drag up and down'] = { open: await browser.evaluate(MENU_OPEN) }
    // 120px of its 320 over 800 ms, and 60px in 60 ms.
    for (const [how, path] of [
      ['past 30%, slowly', line(250, 400, -120, 0, 800)],
      ['a quick 60px flick', line(250, 400, -60, 0, 60, 4)],
    ] as const) {
      await swipe([...path])
      await browser.waitFor(MENU_SHUT, 2000)
      await settle()
      await frames()
      seen[how] = await browser.evaluate(MENU_STATE)
      await open()
    }
    await browser.evaluate(`document.querySelector('.ab-drawer').close(); true`)
  })
  const shut = { open: false, expanded: 'false', focus: 'Menu', ring: false }
  assert.deepEqual(seen, {
    following: { left: -40, right: 'a little', open: true },
    'a short slow drag': { open: true, shift: 0, drag: '' },
    'a drag up and down': { open: true },
    'past 30%, slowly': shut,
    'a quick 60px flick': shut,
    'swiped open, dragged shut': shut,
  })
})

test('under reduced motion, the device’s or the site’s, the menu doesn’t follow the finger, but a swipe on the header still opens it and a drag left still shuts it', async () => {
  const seen: Record<string, unknown> = {}
  for (const motion of ['reduced on the device', 'reduced on the site']) {
    await browser.load({ ...PHONE, reduceMotion: motion === 'reduced on the device' })
    assert.ok(await browser.titlesShown())
    if (motion === 'reduced on the site')
      await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
    await browser.landAll()
    const logo = await browser.evaluate<number>(
      `(({ left, width }) => left + width / 2)(document.querySelector('.ab-logo').getBoundingClientRect())`,
    )
    await withTouch(async () => {
      await swipe(line(logo, 39, 80, 0, 400))
      const opened = await browser.waitFor(MENU_OPEN, 1000)
      await browser.waitFor(
        `document.querySelector('.ab-drawer').getAnimations().length === 0`,
        2000,
      )
      let shift: unknown = null
      await swipe(line(250, 400, -150, 0, 800), {
        mid: async () => {
          await frames()
          shift = await browser.evaluate(PANEL_SHIFT)
        },
      })
      const shut = await browser.waitFor(MENU_SHUT, 2000)
      await frames()
      // Swiped open and dragged shut, no tap anywhere: focus back on Menu, with no ring.
      const { focus, ring } = await browser.evaluate<{ focus: string; ring: boolean }>(MENU_STATE)
      seen[motion] = { opened, shift, shut, focus, ring }
    })
  }
  const still = { opened: true, shift: 0, shut: true, focus: 'Menu', ring: false }
  assert.deepEqual(seen, { 'reduced on the device': still, 'reduced on the site': still })
})

// ---------- Phones: the header hides on a scroll down, and comes back on a scroll up ----------

// The header: whether the page has it hidden, where it is drawn on the screen, and the scroll.
const TOP = `(() => {
  const top = document.querySelector('.ab-top')
  const box = top.getBoundingClientRect()
  return { hidden: top.hasAttribute('data-hide'), top: Math.round(box.top), y: Math.round(scrollY) }
})()`
type Top = { hidden: boolean; top: number; y: number }
// Shown at the top of the screen, or hidden up it, as a word for a check's message.
const where = ({ hidden, top }: Top) =>
  `${hidden ? 'hidden' : 'shown'}, drawn at ${top === 0 ? 'the top' : top === -78 ? 'up out of sight' : `${top}px`}`

/**
 * Scrolls a phone to `y` from 60px below it, so its header shows there, as a visitor's scroll up
 * brings it back.
 */
async function headerBackAt(y: number) {
  await scrollAndSettle(y + 60)
  await scrollAndSettle(y)
}

test('on a phone the header stays on the screen: it hides once the page has gone 12px down from its highest point, comes back once it has gone 8px up from its lowest, and shows near the top; from 900px it never hides', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  assert.equal(
    await browser.evaluate(`getComputedStyle(document.querySelector('.ab-top')).position`),
    'sticky',
    'the header doesn’t stay at the top of the screen',
  )
  const seen: Record<string, string> = {}
  for (const [step, y] of [
    ['at the top', 0],
    ['70px down, within its own height', 70],
    ['far down', 1000],
    ['7px up', 993],
    ['8px up', 992],
    ['11px down from there', 1003],
    ['12px down', 1004],
    ['further down', 1500],
    ['8px up again', 1492],
    ['back near the top, from hidden', 1600],
    ['60px down', 60],
  ] as const) {
    await scrollAndSettle(y)
    seen[step] = where(await browser.evaluate<Top>(TOP))
  }
  const shown = where({ hidden: false, top: 0, y: 0 })
  const hidden = where({ hidden: true, top: -78, y: 0 })
  assert.deepEqual(seen, {
    'at the top': shown,
    '70px down, within its own height': shown,
    'far down': hidden,
    '7px up': hidden,
    '8px up': shown,
    '11px down from there': shown,
    '12px down': hidden,
    'further down': hidden,
    '8px up again': shown,
    'back near the top, from hidden': hidden,
    '60px down': shown,
  })
  await browser.load({ width: 900, height: 900, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  for (const y of [2000, 1990, 3000]) await scrollAndSettle(y)
  assert.equal(where(await browser.evaluate<Top>(TOP)), shown, '900px, scrolled down')
})

test('with motion allowed the phone header slides up in 0.2s and back down in 0.28s, easing out; under reduced motion, the device’s or the site’s, it hides and comes back at once; nothing on the page moves', async () => {
  // The header's own transitions under way: what each moves, how long and how it eases.
  const sliding = `document.querySelector('.ab-top').getAnimations().map((a) => a.transitionProperty + ' ' + a.effect.getTiming().duration + ' ' + a.effect.getTiming().easing).join(', ')`
  const seen: Record<string, unknown> = {}
  for (const motion of ['allowed', 'reduced on the device', 'reduced on the site']) {
    await browser.watchLayoutShifts()
    await browser.load({ ...PHONE, reduceMotion: motion === 'reduced on the device' })
    assert.ok(await browser.titlesShown())
    if (motion === 'reduced on the site')
      await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
    await browser.landAll()
    await browser.animationsDone()
    const before = (await browser.layoutShift()).value
    await scrollAndSettle(1000)
    const hiding = await browser.evaluate<string>(sliding)
    await browser.animationsDone()
    const hidden = where(await browser.evaluate<Top>(TOP))
    await scrollAndSettle(980)
    const showing = await browser.evaluate<string>(sliding)
    await browser.animationsDone()
    const shown = where(await browser.evaluate<Top>(TOP))
    const shift = (await browser.layoutShift()).value - before
    seen[motion] = { hiding, hidden, showing, shown, moved: shift < 0.01 ? 'nothing' : shift }
  }
  const at = {
    hidden: where({ hidden: true, top: -78, y: 0 }),
    shown: where({ hidden: false, top: 0, y: 0 }),
    moved: 'nothing',
  }
  assert.deepEqual(seen, {
    allowed: {
      ...at,
      hiding: 'transform 200 cubic-bezier(0.4, 0, 1, 1)',
      showing: 'transform 280 cubic-bezier(0.2, 0.9, 0.3, 1)',
    },
    'reduced on the device': { ...at, hiding: '', showing: '' },
    'reduced on the site': { ...at, hiding: '', showing: '' },
  })
})

test('on a phone, Shift+Tab back up into the hidden header shows it at once, with the page where it was, and focus with its ring in it keeps it on the screen', async () => {
  // With motion allowed: a header still sliding down as focus reached it had the browser scroll
  // the page up to it.
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  await scrollAndSettle(1600)
  await browser.animationsDone()
  assert.equal(where(await browser.evaluate<Top>(TOP)), where({ hidden: true, top: -78, y: 0 }))
  // From the page's first stop, at its top, out of sight: back one is the search box.
  assert.ok(
    await browser.evaluate(`(() => {
      const first = [...document.querySelectorAll('main :is(a[href], button, input, [tabindex="0"])')].find((el) => el.checkVisibility())
      first.focus({ preventScroll: true })
      return document.activeElement === first && scrollY === 1600
    })()`),
    'focus didn’t go to the page’s first stop, or the page moved',
  )
  const seen: Record<string, unknown> = {}
  const look = async () => {
    const top = await browser.evaluate<Top>(TOP)
    return {
      focus: await browser.evaluate<string>(
        `document.activeElement.getAttribute('aria-label') ?? document.activeElement.placeholder ?? document.activeElement.className`,
      ),
      header: where(top),
      y: top.y,
    }
  }
  await browser.press('Tab', true)
  // In the same frame, before the page would have scrolled: the header is in place.
  seen['Shift+Tab, at once'] = await browser.evaluate(`({
    top: Math.round(document.querySelector('.ab-top').getBoundingClientRect().top),
    y: Math.round(scrollY),
  })`)
  await frames()
  seen['Shift+Tab onto the search box'] = await look()
  await browser.press('Tab', true)
  await frames()
  seen['Shift+Tab onto AniBeam'] = await look()
  await browser.evaluate(`scrollBy(0, 400); true`)
  await frames()
  seen['then 400px down'] = await look()
  const shown = where({ hidden: false, top: 0, y: 0 })
  assert.deepEqual(seen, {
    'Shift+Tab, at once': { top: 0, y: 1600 },
    'Shift+Tab onto the search box': { focus: 'Search titles', header: shown, y: 1600 },
    'Shift+Tab onto AniBeam': { focus: 'ab-logo', header: shown, y: 1600 },
    'then 400px down': { focus: 'ab-logo', header: shown, y: 2000 },
  })
})

test('on a phone the header hides on the next scroll down after the menu shuts by its X, a tap on the dimmed page or a swipe, focus back on the menu button with no ring; after Esc, whose ring shows, it stays', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const seen: Record<string, unknown> = {}
  await withTouch(async () => {
    for (const how of ['its X', 'a tap on the dimmed page', 'a swipe to the left', 'Esc']) {
      await scrollAndSettle(0)
      await sleep(550)
      await tapOn('.ab-burger')
      assert.ok(await browser.waitFor(MENU_OPEN, 2000), `${how}: the menu didn’t open`)
      if (how === 'its X') await tapOn('.ab-drawer .ab-close')
      else if (how === 'Esc') await browser.press('Escape')
      else if (how === 'a swipe to the left') await swipe(line(250, 400, -150, 0, 300))
      else await tap(375, 600)
      assert.ok(await browser.waitFor(MENU_SHUT, 2000), `${how}: the menu didn’t shut`)
      await frames()
      // A finger's scroll down the page.
      await browser.send('Input.synthesizeScrollGesture', {
        x: 195,
        y: 700,
        yDistance: -700,
        speed: 1200,
        gestureSourceType: 'touch',
      })
      await frames()
      const { focus, ring } = await browser.evaluate<{ focus: string; ring: boolean }>(MENU_STATE)
      const top = await browser.evaluate<Top>(TOP)
      seen[how] = { focus, ring, header: where(top), scrolled: top.y > 500 }
    }
  })
  const after = {
    focus: 'Menu',
    ring: false,
    header: where({ hidden: true, top: -78, y: 0 }),
    scrolled: true,
  }
  assert.deepEqual(seen, {
    'its X': after,
    'a tap on the dimmed page': after,
    'a swipe to the left': after,
    Esc: { ...after, ring: true, header: where({ hidden: false, top: 0, y: 0 }) },
  })
})

test('on a phone a scroll that a move of focus makes leaves the header as it is: Tab down keeps it shown, Shift+Tab up keeps it hidden, and a menu link’s jump lands its heading 18px below it', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const panels = await browser.evaluate<number>(
    `document.querySelectorAll('.ab-grid .ab-link').length`,
  )
  const panel = (i: number) => `document.querySelectorAll('.ab-grid .ab-link')[${i}]`
  const seen: Record<string, unknown> = {}
  // Shown near the page's top, focus on the last trending panel but one, out of sight below: Tab
  // to the last brings it up from below.
  await headerBackAt(200)
  await browser.evaluate(`${panel(panels - 2)}.focus({ preventScroll: true }); true`)
  await browser.press('Tab')
  await frames()
  let top = await browser.evaluate<Top>(TOP)
  seen['Tab down the page'] = { header: where(top), scrolled: top.y > 600 ? 'down' : top.y }
  // Hidden, far down, focus on the last panel: Shift+Tab to the one before brings it down from
  // above.
  await scrollAndSettle(`${panel(panels - 1)}.getBoundingClientRect().top + scrollY + 1200`)
  await browser.evaluate(`${panel(panels - 1)}.focus({ preventScroll: true }); true`)
  const from = (await browser.evaluate<Top>(TOP)).y
  await browser.press('Tab', true)
  await frames()
  top = await browser.evaluate<Top>(TOP)
  seen['Shift+Tab up the page'] = {
    header: where(top),
    scrolled: top.y < from - 600 ? 'up' : top.y - from,
  }
  // Shown near the top, the menu's Pull jumps down the page: the header stays, Pull under it.
  await browser.evaluate(`document.activeElement.blur(); true`)
  await headerBackAt(200)
  await withTouch(async () => {
    await sleep(550)
    await tapOn('.ab-burger')
    assert.ok(await browser.waitFor(MENU_OPEN, 2000), 'the menu didn’t open')
    await tapOn('.ab-drawer a[href="#pull"]')
    await browser.waitFor(`!(${MENU_OPEN}) && document.activeElement.id === 'pull'`, 2000)
  })
  await frames()
  top = await browser.evaluate<Top>(TOP)
  seen['the menu’s Pull'] = {
    header: where(top),
    pull: await browser.evaluate(
      `Math.round(document.getElementById('pull').getBoundingClientRect().top - document.querySelector('.ab-top').getBoundingClientRect().bottom) + 'px below the header'`,
    ),
  }
  const shown = where({ hidden: false, top: 0, y: 0 })
  assert.deepEqual(seen, {
    'Tab down the page': { header: shown, scrolled: 'down' },
    'Shift+Tab up the page': { header: where({ hidden: true, top: -78, y: 0 }), scrolled: 'up' },
    'the menu’s Pull': { header: shown, pull: '18px below the header' },
  })
})

// A trending panel on a phone, placed `top` px below the screen's top with the header shown.
async function panelUnderHeader(top: number) {
  const panel = `document.querySelectorAll('.ab-grid .ab-link')[4]`
  await browser.evaluate(`${panel}.scrollIntoView({ block: 'start', behavior: 'instant' }); true`)
  await frames()
  await headerBackAt(
    await browser.evaluate<number>(`scrollY + ${panel}.getBoundingClientRect().top - ${top}`),
  )
  return panel
}

test('on a phone the header never covers a focus ring: it goes up as focus with its ring comes under it, and waits to come back while one is there; a tap’s focus, with no ring, leaves it be', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const header = async () => where(await browser.evaluate<Top>(TOP))
  const shown = where({ hidden: false, top: 0, y: 0 })
  const hidden = where({ hidden: true, top: -78, y: 0 })
  const seen: Record<string, unknown> = {}
  // Focus with its ring moved by a script, with no scroll, onto a panel just below the header with
  // its ring (7px out) under it, and onto one well under it.
  for (const top of [83, 20]) {
    await browser.evaluate(`document.activeElement.blur(); true`)
    const panel = await panelUnderHeader(top)
    const before = await header()
    await browser.evaluate(`${panel}.focus({ preventScroll: true, focusVisible: true }); true`)
    await frames()
    seen[`focus ${top}px down`] = {
      before,
      ring: await browser.evaluate(`document.activeElement.matches(':focus-visible')`),
      after: await header(),
    }
  }
  // Hidden, with that ring near the top: 20px up and it waits; once the panel is well down, back.
  const y = (await browser.evaluate<Top>(TOP)).y
  await scrollAndSettle(y - 20)
  seen['20px up, the ring near the top'] = await header()
  await scrollAndSettle(y - 300)
  seen['300px up, the ring well down'] = await header()
  // A tap on a panel's part below the header: focus with no ring, and the header stays.
  await browser.evaluate(`document.activeElement.blur(); true`)
  const panel = await panelUnderHeader(30)
  const point = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const box = ${panel}.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + 80 }
  })()`)
  const press = { x: point.x, y: point.y, button: 'left', clickCount: 1 }
  await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press })
  await frames()
  seen['a tap 30px down'] = {
    ring: await browser.evaluate(`document.activeElement.matches(':focus-visible')`),
    header: await header(),
  }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press })
  await browser.waitFor(`document.querySelector('.ab-card[open]')`, 2000)
  await browser.evaluate(`document.querySelector('.ab-card[open]')?.close(); true`)
  assert.deepEqual(seen, {
    'focus 83px down': { before: shown, ring: true, after: hidden },
    'focus 20px down': { before: shown, ring: true, after: hidden },
    '20px up, the ring near the top': hidden,
    '300px up, the ring well down': shown,
    'a tap 30px down': { ring: false, header: shown },
  })
})

test('on a phone, a part that shows only under the header, back on a scroll up, waits to land until it shows below it', async () => {
  // The pull machine, scrolled up into view with the header coming back: most of what shows of
  // it is under the header, and less than the 15% a part needs below it. The scroll slam counts
  // the header as covering the top while it shows (lib/landing.ts).
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  const { top, height } = await browser.evaluate<{ top: number; height: number }>(`(() => {
    const machine = document.querySelector('.ab-machine')
    let top = 0
    for (let el = machine; el; el = el.offsetParent) top += el.offsetTop
    return { top, height: machine.offsetHeight }
  })()`)
  assert.equal(await browser.evaluate(`document.querySelector('.ab-machine').dataset.land`), 'wait')
  // Below the header, 10px short of 15% of it; above, under the header, 78px more.
  const below = Math.floor(height * 0.15) - 10
  const y = top - (78 + below - height)
  await browser.evaluate(`scrollTo(0, ${y + 80}); true`)
  await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`)
  await browser.evaluate(`scrollTo(0, ${y}); true`)
  await frames()
  const now = await browser.evaluate<{ hidden: boolean; land: string }>(
    `({ hidden: document.querySelector('.ab-top').hasAttribute('data-hide'), land: document.querySelector('.ab-machine').dataset.land })`,
  )
  assert.deepEqual(now, { hidden: false, land: 'wait' }, 'it landed under the header')
})

// ---------- Phones: the search bubble grows a row at a time as what is typed wraps ----------

// A title recorded as a search, long enough to wrap onto 4 rows at 390px and 8 at 320px.
const LONG_TITLE = 'The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life'
// The search box, as a script finds it.
const BOX = `document.querySelector('.ab-search textarea')`
// The search bubble and its box, and what must hold still around them: the header's height and
// the --top-h it publishes, where the page and the intro's title start, and any sideways scroll.
// The box's rows are its scrolled height in rows of 20px (a phone's box has no padding of its
// own, and a pixel more than its rows; see components.css).
const BUBBLE = `(() => {
  const box = ${BOX}
  if (!box) return null
  const field = document.querySelector('.ab-bubble-field').getBoundingClientRect()
  return {
    bubble: Math.round(field.height),
    bottom: Math.round(field.bottom),
    rows: Math.floor(box.scrollHeight / 20),
    scrolled: box.scrollTop,
    showing: box.clientHeight,
    overflow: getComputedStyle(box).overflowY,
    value: box.value,
    focused: document.activeElement === box,
    header: document.querySelector('.ab-top').offsetHeight,
    topH: getComputedStyle(document.documentElement).getPropertyValue('--top-h'),
    main: Math.round(document.querySelector('main').getBoundingClientRect().top),
    title: Math.round(document.querySelector('.ab-intro-title')?.getBoundingClientRect().top ?? -1),
    sideways: document.documentElement.scrollWidth - innerWidth,
  }
})()`
type Bubble = {
  bubble: number
  bottom: number
  rows: number
  scrolled: number
  showing: number
  overflow: string
  value: string
  focused: boolean
  header: number
  topH: string
  main: number
  title: number
  sideways: number
}
/** The bubble's state, failing the check if there is no search box to measure. */
async function bubbleNow(on: Browser = browser) {
  const seen = await on.evaluate<Bubble | null>(BUBBLE)
  if (!seen) assert.fail(`nothing on the page is .ab-search textarea`)
  return seen
}
const twoFrames = (on: Browser = browser) =>
  on.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  )

test('on a phone the search bubble grows down over the page a row at a time as a long title is typed, keystroke by keystroke, up to three rows, then scrolls a whole row at a time; the header stays one 78px row and nothing else moves', async () => {
  // Under reduced motion, so each row's height is there as soon as the row is. The search's 300
  // ms wait after each keystroke is held off in a browser of the check's own, so no search starts
  // mid-title, however slowly a busy machine types: one would take the intro off the page. (A
  // stopped clock can't do it: Chrome then draws frames, and reports sizes, only now and then.)
  // AniList is blocked there too, so nothing is asked of it.
  for (const [width, height] of [
    [320, 568],
    [390, 844],
  ]) {
    const own = await Browser.open()
    try {
      await own.blockAniList()
      await own.load({ width, height, phone: true, reduceMotion: true })
      await own.animationsDone()
      // From here on, what moves on the page, outside the search bubble: a pseudo-element (the
      // bubble's tail) by the element it is drawn on.
      await own.evaluate(`(() => {
        const wait = window.setTimeout
        window.setTimeout = (run, ms, ...rest) => (ms === 300 ? 0 : wait(run, ms, ...rest))
        window.__moved = []
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            for (const { node, previousRect, currentRect } of entry.sources) {
              const el = node?.nodeType === 1 && !node.nodeName.startsWith('::') ? node : node?.parentElement
              if (!el?.closest('.ab-search'))
                window.__moved.push((el?.className || node?.nodeName) + ': ' + Math.round(previousRect.top) + ' → ' + Math.round(currentRect.top) + 'px')
            }
        }).observe({ type: 'layout-shift' })
        ${BOX}?.focus()
        return true
      })()`)
      const start = await bubbleNow(own)
      const problems: string[] = []
      const heights = new Set<number>()
      let most = 0
      for (let i = 0; i < LONG_TITLE.length; i++) {
        await own.send('Input.insertText', { text: LONG_TITLE[i] })
        await twoFrames(own)
        const now = await bubbleNow(own)
        const at = `${width}px, "${LONG_TITLE.slice(0, i + 1)}"`
        heights.add(now.bubble)
        most = Math.max(most, now.rows)
        if (now.bubble !== 30 + 20 * Math.min(now.rows, 3))
          problems.push(`${at}: ${now.rows} rows, but the bubble is ${now.bubble}px tall`)
        if (now.header !== 78 || now.topH !== '78px')
          problems.push(`${at}: the header is ${now.header}px tall, --top-h ${now.topH}`)
        if (now.main !== start.main || now.title !== start.title)
          problems.push(
            `${at}: the page moved, its top ${start.main} → ${now.main}px, the intro’s title ${start.title} → ${now.title}px`,
          )
        if (now.sideways > 0) problems.push(`${at}: the page scrolls ${now.sideways}px sideways`)
        // Up to three rows the text holds still as the bubble grows, and a finger's scroll on the
        // box is the page's. Past three, the box scrolls, showing the last three rows whole.
        if (now.rows <= 3 && (now.scrolled !== 0 || now.overflow !== 'hidden'))
          problems.push(`${at}: the box is scrolled ${now.scrolled}px, overflow ${now.overflow}`)
        if (
          now.rows > 3 &&
          (now.scrolled % 20 !== 0 || now.scrolled < 20 * (now.rows - 3) || now.overflow !== 'auto')
        )
          problems.push(
            `${at}: ${now.rows} rows, the box scrolled ${now.scrolled}px, overflow ${now.overflow}`,
          )
      }
      await twoFrames(own)
      const moved = await own.evaluate<string[]>('window.__moved')
      assert.deepEqual(problems, [], `${width}px: as the title was typed`)
      assert.deepEqual(moved, [], `${width}px: something on the page moved as the bubble grew`)
      assert.deepEqual(
        [...heights].sort(),
        [50, 70, 90],
        `${width}px: the bubble wasn’t 50, 70 and 90px tall, one to three rows`,
      )
      assert.ok(most > 3, `${width}px: the title took only ${most} rows`)
    } finally {
      await own.close()
    }
  }
})

test('on a phone Enter adds no new line and on a touch screen puts the keyboard away; as focus leaves, the bubble folds back to one row showing the first; pasted line breaks become spaces; Esc empties the box', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const seen: Record<string, unknown> = {}
  await withTouch(async () => {
    await browser.search(LONG_TITLE)
    assert.ok(
      await browser.waitFor(`document.querySelector('#results')?.textContent.includes('Laid-Off')`),
      'the long title was never searched',
    )
    await twoFrames()
    const typed = await bubbleNow()
    seen.typed = {
      bubble: typed.bubble,
      rows: typed.rows > 3 ? 'more than 3' : typed.rows,
      focused: typed.focused,
    }
    // The phone keyboard's Search key is an Enter.
    await browser.press('Enter')
    await twoFrames()
    const entered = await bubbleNow()
    seen.entered = {
      bubble: entered.bubble,
      scrolled: entered.scrolled,
      overflow: entered.overflow,
      focused: entered.focused,
      value: entered.value,
    }
  })
  // With a mouse, Enter leaves focus in the box, and still adds no new line.
  await browser.evaluate(`${BOX}.focus(); true`)
  await browser.press('Enter')
  await twoFrames()
  const mouse = await bubbleNow()
  seen.mouse = { focused: mouse.focused, value: mouse.value }
  // A paste of two lines.
  await browser.evaluate(`${BOX}.select(); true`)
  await browser.send('Input.insertText', { text: 'one\npiece' })
  assert.ok(
    await browser.waitFor(
      `document.querySelector('#results')?.textContent.includes('“one piece”')`,
    ),
    'the pasted search never showed its results',
  )
  seen.pasted = (await bubbleNow()).value
  await browser.press('Escape')
  seen.escaped = (await bubbleNow()).value
  assert.deepEqual(seen, {
    typed: { bubble: 90, rows: 'more than 3', focused: true },
    entered: { bubble: 50, scrolled: 0, overflow: 'hidden', focused: false, value: LONG_TITLE },
    mouse: { focused: true, value: LONG_TITLE },
    pasted: 'one piece',
    escaped: '',
  })
})

test('on a phone, with a long title in the box and focus gone, the header hiding up the screen takes the whole bubble with it', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.search(LONG_TITLE)
  assert.ok(
    await browser.waitFor(`document.querySelector('#results')?.textContent.includes('Laid-Off')`),
    'the long title was never searched',
  )
  await browser.evaluate(`${BOX}.blur(); true`)
  await scrollAndSettle(1000)
  const { hidden } = await browser.evaluate<Top>(TOP)
  const { bubble, bottom } = await bubbleNow()
  // Its tail hangs 14px below it.
  assert.deepEqual(
    { hidden, bubble, showing: bottom + 14 > 0 },
    { hidden: true, bubble: 50, showing: false },
    'the hidden header left part of the bubble on the screen',
  )
})

test('on a phone a finger’s scroll that starts on the search bubble scrolls the page, empty or holding a word', async () => {
  const seen: Record<string, number> = {}
  for (const width of [320, 390]) {
    await browser.load({ width, height: 700, phone: true, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await withTouch(async () => {
      for (const word of ['', 'naruto']) {
        if (word) {
          await browser.search(word)
          assert.ok(
            await browser.waitFor(
              `document.querySelector('#results')?.textContent.includes('“naruto”')`,
            ),
            'naruto was never searched',
          )
          await browser.evaluate(`${BOX}.blur(); true`)
        }
        await scrollAndSettle(0)
        const { x, y } = await middleOf('.ab-bubble-field')
        await swipe(line(x, y, 0, -250, 300))
        await sleep(400)
        seen[`${width}px, ${word || 'empty'}`] =
          (await browser.evaluate<number>('scrollY')) > 150 ? 1 : 0
      }
    })
  }
  assert.deepEqual(
    seen,
    { '320px, empty': 1, '320px, naruto': 1, '390px, empty': 1, '390px, naruto': 1 },
    'a scroll that started on the bubble left the page where it was (1 is scrolled)',
  )
})

test('with motion allowed the search bubble eases to its new rows in 0.3s; under reduced motion, the device’s or the site’s, it takes them at once', async () => {
  // The bubble's height transitions under way: how long each takes.
  const growing = `document.querySelector('.ab-bubble-field').getAnimations().filter((a) => a.transitionProperty === 'height').map((a) => a.effect.getTiming().duration).join()`
  const seen: Record<string, unknown> = {}
  for (const motion of ['allowed', 'reduced on the device', 'reduced on the site']) {
    await browser.load({ ...PHONE, reduceMotion: motion === 'reduced on the device' })
    assert.ok(await browser.titlesShown())
    if (motion === 'reduced on the site')
      await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
    await browser.evaluate(`${BOX}?.focus(); true`)
    await browser.animationsDone()
    await browser.send('Input.insertText', { text: LONG_TITLE })
    await twoFrames()
    const during = await browser.evaluate<string>(growing)
    const grown = (await bubbleNow()).bubble
    await browser.animationsDone()
    seen[motion] = { during, grown: motion === 'allowed' ? grown < 90 : grown === 90 }
    await browser.evaluate(`${BOX}.blur(); true`)
  }
  assert.deepEqual(seen, {
    allowed: { during: '300', grown: true },
    'reduced on the device': { during: '', grown: true },
    'reduced on the site': { during: '', grown: true },
  })
})

test('from 900px the search keeps to one line as before, and while it holds a query a Clear search button at its end, no Tab stop, empties it and keeps focus in the box; Esc empties it too', async () => {
  const STATE = `(() => {
    const box = ${BOX}, field = document.querySelector('.ab-bubble-field').getBoundingClientRect()
    const clear = document.querySelector('.ab-clear')
    const drawn = clear?.checkVisibility() ? clear.getBoundingClientRect() : null
    const style = getComputedStyle(box)
    return {
      bubble: Math.round(field.height),
      header: document.querySelector('.ab-top').offsetHeight,
      oneLine: box.scrollHeight <= box.clientHeight,
      clear: drawn && {
        size: Math.round(drawn.width) + 'x' + Math.round(drawn.height),
        name: clear.getAttribute('aria-label'),
        tabStop: clear.tabIndex >= 0,
        inside: drawn.right <= field.right - 3 && drawn.left >= field.left,
        clearOfText: box.getBoundingClientRect().right - parseFloat(style.paddingRight) <= drawn.left,
      },
      value: box.value,
      focused: document.activeElement === box,
    }
  })()`
  const long =
    'a very long search that keeps going and going past the width of the bubble and the screen '.repeat(
      2,
    )
  const seen: Record<string, unknown> = {}
  for (const width of [900, 1440]) {
    await browser.load({ width, height: 900, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    seen[`${width}px at rest`] = await browser.evaluate(STATE)
    await browser.search(long)
    assert.ok(
      await browser.waitFor(
        `document.querySelector('#results')?.textContent.includes('keeps going')`,
      ),
      'the long search never showed its results',
    )
    seen[`${width}px holding a long query`] = await browser.evaluate(STATE)
    await clickAt('.ab-clear')
    await twoFrames()
    seen[`${width}px cleared`] = await browser.evaluate(STATE)
    await browser.search('naruto')
    await browser.press('Tab')
    seen[`${width}px, Tab from the box`] = await browser.evaluate(
      `document.activeElement.matches('.ab-clear') ? 'to the clear button' : 'on past it'`,
    )
    await browser.evaluate(`${BOX}.focus(); true`)
    await browser.press('Escape')
    seen[`${width}px, Esc`] = await browser.evaluate(`${BOX}.value`)
  }
  const rest = { bubble: 50, header: 78, oneLine: true, clear: null, value: '', focused: false }
  const holding = {
    bubble: 50,
    header: 78,
    oneLine: true,
    clear: {
      size: '24x24',
      name: 'Clear search',
      tabStop: false,
      inside: true,
      clearOfText: true,
    },
    value: long,
    focused: true,
  }
  const cleared = { ...rest, focused: true }
  assert.deepEqual(seen, {
    '900px at rest': rest,
    '900px holding a long query': holding,
    '900px cleared': cleared,
    '900px, Tab from the box': 'on past it',
    '900px, Esc': '',
    '1440px at rest': rest,
    '1440px holding a long query': holding,
    '1440px cleared': cleared,
    '1440px, Tab from the box': 'on past it',
    '1440px, Esc': '',
  })
})
