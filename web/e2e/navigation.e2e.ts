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

test('under 900px the header’s section links wait hidden while the intro is on the page, and show while searching; the header keeps its size', async () => {
  const header = `(() => { const top = document.querySelector('.ab-top'); return [top.offsetHeight, getComputedStyle(top).position, document.querySelector('.ab-top .ab-soon').offsetLeft].join(' ') })()`
  for (const screen of [
    { width: 390, height: 844, phone: true },
    { width: 768, height: 1024, phone: true },
    { width: 860, height: 900 },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    assert.deepEqual(
      await browser.evaluate(SHOWN),
      { links: 'intro', header: false, intro: true },
      `${screen.width}px, at the top`,
    )
    const atTop = await browser.evaluate<string>(header)
    await scrollAndSettle('document.documentElement.scrollHeight')
    assert.equal(
      (await browser.evaluate<{ links: string }>(SHOWN)).links,
      'intro',
      `${screen.width}px, at the end: they never dock`,
    )
    await scrollAndSettle(0)
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`, 10_000),
    )
    assert.deepEqual(
      await browser.evaluate(SHOWN),
      { links: 'header', header: true, intro: false },
      `${screen.width}px, searching`,
    )
    assert.equal(
      await browser.evaluate<string>(header),
      atTop,
      `${screen.width}px: the header changed`,
    )
    assert.match(atTop, / relative /, `${screen.width}px: the header no longer scrolls away`)
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

const PHONE = { width: 390, height: 844, phone: true }
// A phone's bar: whether it is the set shown, drawn, reachable, and what it reads.
const BAR = `(() => {
  const bar = document.querySelector('.ab-bar')
  return {
    links: document.querySelector('.ab-app').dataset.links,
    drawn: getComputedStyle(bar).visibility === 'visible',
    inert: bar.inert,
    reads: [...bar.querySelectorAll('a')].map((a) => a.textContent).join(' / '),
    current: bar.querySelector('a[aria-current="location"]')?.textContent ?? 'none',
  }
})()`
/** Scrolls a phone well past the intro's buttons, then up `up` px, a frame for each step. */
async function revealBar(up = 40) {
  const past = await browser.evaluate<number>(`(() => {
    let top = 0
    for (let el = document.querySelector('.ab-intro-actions'); el; el = el.offsetParent) top += el.offsetTop
    return top + 1400
  })()`)
  await scrollAndSettle(past)
  await scrollAndSettle(past - up)
  return past - up
}

test('on a phone, once the intro’s buttons have gone, the links bar slides in on a scroll up and out on a scroll down', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const out = { links: 'intro', drawn: false, inert: true, reads: 'Trending / Pull / Decades' }
  const look = async () => {
    const { current, ...rest } = await browser.evaluate<Record<string, unknown>>(BAR)
    return { rest, current }
  }
  assert.deepEqual((await look()).rest, out, 'at the top')
  // Up a little with the buttons still on the screen: nothing.
  await scrollAndSettle(300)
  await scrollAndSettle(260)
  assert.deepEqual((await look()).rest, out, 'with the buttons on the screen')
  const y = await revealBar()
  const shown = await look()
  assert.deepEqual(
    shown.rest,
    { links: 'bar', drawn: true, inert: false, reads: 'Trending / Pull / Decades' },
    'scrolled up',
  )
  assert.notEqual(shown.current, 'none', 'no section marked in the bar')
  assert.equal(
    await browser.evaluate(
      `getComputedStyle(document.querySelector('.ab-bar a[aria-current="location"]')).backgroundColor`,
    ),
    'rgb(255, 212, 0)',
  )
  await scrollAndSettle(y + 40)
  assert.deepEqual((await look()).rest, out, 'scrolled down again')
  assert.equal(
    await browser.evaluate(`getComputedStyle(document.querySelector('.ab-top')).position`),
    'relative',
  )
})

test('on a phone, one set of section links is drawn at a time, the bar in or out, and while searching', async () => {
  const drawn = `[...document.querySelectorAll('a[href="#ab-trending"], a[href="#pull"], a[href="#decades"]')].filter((a) => a.checkVisibility({ visibilityProperty: true }) && !a.closest('[inert]')).map((a) => a.getAttribute('href')).sort().join(' ')`
  const all = '#ab-trending #decades #pull'
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  assert.equal(await browser.evaluate(drawn), all, 'at the top')
  await revealBar()
  assert.equal(await browser.evaluate(drawn), all, 'the bar in')
  await scrollAndSettle(0)
  await browser.search('frieren')
  assert.ok(
    await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`, 10_000),
  )
  assert.equal(await browser.evaluate(drawn), all, 'while searching')
})

test('on a phone, focus in the bar keeps it in, and a jump from it lands its heading clear of it', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await revealBar()
  await browser.evaluate(
    `document.querySelector('.ab-bar a[href="#pull"]').focus({ preventScroll: true }); true`,
  )
  await browser.evaluate(`scrollBy(0, 300); true`)
  await frames()
  assert.deepEqual(
    await browser.evaluate(
      `({ links: document.querySelector('.ab-app').dataset.links, focus: document.activeElement.textContent })`,
    ),
    { links: 'bar', focus: 'Pull' },
    'scrolled down with focus in the bar',
  )
  // Its Trending link, followed from the keyboard: the heading takes focus, clear of the bar.
  await browser.evaluate(`document.querySelector('.ab-bar a[href="#ab-trending"]').focus(); true`)
  await browser.press('Enter')
  assert.ok(await browser.waitFor(`document.activeElement?.id === 'ab-trending'`, 5000), 'no jump')
  await frames()
  const clear = await browser.evaluate<{ links: string; ring: number; bar: number }>(`({
    links: document.querySelector('.ab-app').dataset.links,
    ring: Math.round(document.activeElement.getBoundingClientRect().top - 7),
    bar: Math.round(document.querySelector('.ab-bar').getBoundingClientRect().bottom),
  })`)
  assert.ok(
    clear.links !== 'bar' || clear.ring >= clear.bar,
    `the heading's ring at ${clear.ring}px, under the bar to ${clear.bar}px`,
  )
})

test('the bar slides with motion allowed, and comes and goes at once under reduced motion; nothing on the page moves either way', async () => {
  for (const reduceMotion of [false, true]) {
    await browser.watchLayoutShifts()
    await browser.load({ ...PHONE, reduceMotion })
    assert.ok(await browser.titlesShown())
    await browser.landAll()
    await browser.animationsDone()
    const before = (await browser.layoutShift()).value
    await revealBar()
    const slide = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-bar')).transitionDuration`,
    )
    assert.equal(
      slide,
      reduceMotion ? '0s' : '0.22s, 0s',
      reduceMotion ? 'reduced motion' : 'motion allowed',
    )
    await browser.evaluate(`scrollBy(0, 200); true`)
    await frames()
    await browser.animationsDone()
    assert.ok(
      (await browser.layoutShift()).value - before < 0.01,
      `${reduceMotion ? 'reduced motion' : 'motion'}: the page shifted`,
    )
  }
})

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
  assert.deepEqual([...new Set(flying.map((a) => a.changes))].sort(), ['opacity', 'transform'])
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

test('on a phone, a part that shows only under the links bar waits to land until it shows below it', async () => {
  // The pull machine, scrolled up into view with the bar coming in: most of what shows of it is
  // under the bar, and less than the 15% a part needs below it. The scroll slam counts the bar
  // as covering the top, as it counts the sticky header from 900px (lib/landing.ts).
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  const { top, height, bar } = await browser.evaluate<{
    top: number
    height: number
    bar: number
  }>(`(() => {
    const machine = document.querySelector('.ab-machine')
    let top = 0
    for (let el = machine; el; el = el.offsetParent) top += el.offsetTop
    return { top, height: machine.offsetHeight, bar: (({ offsetTop, offsetHeight }) => offsetTop + offsetHeight)(document.querySelector('.ab-bar')) }
  })()`)
  assert.equal(await browser.evaluate(`document.querySelector('.ab-machine').dataset.land`), 'wait')
  // Below the bar, 10px short of 15% of it; above, under the bar, the bar's height more.
  const below = Math.floor(height * 0.15) - 10
  const y = top - (bar + below - height)
  await browser.evaluate(`scrollTo(0, ${y + 80}); true`)
  await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`)
  await browser.evaluate(`scrollTo(0, ${y}); true`)
  await frames()
  const now = await browser.evaluate<{ links: string; land: string }>(
    `({ links: document.querySelector('.ab-app').dataset.links, land: document.querySelector('.ab-machine').dataset.land })`,
  )
  assert.equal(now.links, 'bar', 'the bar didn’t come in')
  assert.equal(now.land, 'wait', 'it landed under the bar')
})

test('on a phone, focus that a move brings in at the top of the screen is never left under the links bar', async () => {
  // A desktop browser zoomed to 200%, or a tablet with a keyboard: under 900px, with the bar in.
  // Shift+Tab from the picked decade chip to the Pull! lever, just above the screen: Firefox (and,
  // likely, Safari) brings what takes focus in at the nearest edge, here 10px from the top, under
  // the bar. Chrome brings it to the middle, so here the move is made as they make it: focus, then
  // the scroll to the top, together.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  const y = await browser.evaluate<number>(`(() => {
    const lever = document.querySelector('.ab-lever')
    let top = 0
    for (let el = lever; el; el = el.offsetParent) top += el.offsetTop
    return top + lever.offsetHeight + 20
  })()`)
  await scrollAndSettle(y + 40)
  await scrollAndSettle(y)
  await browser.evaluate(
    `document.querySelector('.ab-eras input:checked').focus({ preventScroll: true }); true`,
  )
  await frames()
  assert.equal(
    await browser.evaluate(`document.querySelector('.ab-app').dataset.links`),
    'bar',
    'the bar didn’t come in',
  )
  await browser.evaluate(`(() => {
    const lever = document.querySelector('.ab-lever')
    lever.focus({ preventScroll: true })
    lever.scrollIntoView({ block: 'start', behavior: 'instant' })
    return true
  })()`)
  await frames()
  const at = await browser.evaluate<{
    name: string
    links: string
    ring: number
    bar: number
  }>(`(() => {
    const focused = document.activeElement
    return {
      name: focused.textContent.trim().slice(0, 30),
      links: document.querySelector('.ab-app').dataset.links,
      ring: Math.round(focused.getBoundingClientRect().top - 7),
      bar: Math.round(document.querySelector('.ab-bar').getBoundingClientRect().bottom),
    }
  })()`)
  assert.equal(at.name, 'Pull!')
  assert.ok(
    at.links !== 'bar' || at.ring >= at.bar,
    `the lever's ring at ${at.ring}px, under the bar to ${at.bar}px`,
  )
})

test('with motion allowed, the links bar slides in with its spring and never shows a strip of the page above it', async () => {
  await browser.load(PHONE)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  // The bar's top edge each frame as it slides in: at or above the screen's top throughout.
  await browser.evaluate(`(() => {
    window.__barTops = []
    const record = () => { window.__barTops.push(document.querySelector('.ab-bar').getBoundingClientRect().top); if (window.__barTops.length < 40) requestAnimationFrame(record) }
    requestAnimationFrame(record)
    return true
  })()`)
  await revealBar()
  await browser.waitFor(`window.__barTops.length >= 40`, 5000)
  const tops = await browser.evaluate<number[]>(`window.__barTops`)
  assert.equal(await browser.evaluate(`document.querySelector('.ab-app').dataset.links`), 'bar')
  assert.ok(
    Math.max(...tops) <= 0,
    `the bar's top came ${Math.max(...tops).toFixed(1)}px below the screen's top`,
  )
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

test('a resize lands a flight under way at once', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  await browser.evaluate(`scrollTo(0, ${await browser.evaluate<number>(DOCK_AT)}); true`)
  await frames()
  assert.ok((await browser.evaluate<unknown[]>(FLIGHT_NOW)).length > 0, 'no flight')
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await frames()
  assert.deepEqual(
    {
      flight: await browser.evaluate(FLIGHT_NOW),
      copies: await browser.evaluate(`document.querySelectorAll('.ab-flight-chip').length`),
      links: (await browser.evaluate<{ links: string }>(SHOWN)).links === 'none' ? 'none' : 'a set',
    },
    { flight: [], copies: 0, links: 'a set' },
    'narrowed mid-flight',
  )
})

test('widening past 900px hands focus in the links bar on to the header’s link to the same place', async () => {
  // Focus in a phone's bar, then wider than 900px, where the bar isn't drawn.
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await revealBar()
  await browser.evaluate(
    `document.querySelector('.ab-bar a[href="#pull"]').focus({ preventScroll: true }); true`,
  )
  assert.deepEqual(
    await browser.evaluate(
      `({ links: document.querySelector('.ab-app').dataset.links, inBar: Boolean(document.activeElement.closest('.ab-bar')) })`,
    ),
    { links: 'bar', inBar: true },
    'focus in the bar, before widening',
  )
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await frames()
  assert.deepEqual(
    await browser.evaluate(
      `({ inHeader: Boolean(document.activeElement.closest('.ab-top')), href: document.activeElement.getAttribute('href'), shown: getComputedStyle(document.activeElement).visibility })`,
    ),
    { inHeader: true, href: '#pull', shown: 'visible' },
    'widened with focus in the bar',
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
    // Reached from the keyboard: Shift+Tab from the heading after the header.
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

test('the three sets of section links share one name, Sections, so each reads alike as a landmark', async () => {
  await browser.load({ ...DESKTOP, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  assert.deepEqual(
    await browser.evaluate(
      `['.ab-top .ab-nav', '.ab-intro-actions', '.ab-bar'].map((sel) => document.querySelector(sel).getAttribute('aria-label'))`,
    ),
    ['Sections', 'Sections', 'Sections'],
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
  await browser.evaluate(`scrollTo(0, ${dockAt}); true`)
  // The first frame: the third copy's 90ms stagger hasn't run out, so it must wait at its start.
  await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`)
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
  await browser.animationsDone()
  const { top, bottom } = await browser.evaluate<{ top: number; bottom: number }>(GEOMETRY)
  await browser.evaluate(
    `scrollTo(0, ${top - Math.ceil(bottom + Math.min(200, top - bottom))}); true`,
  )
  await browser.evaluate(`new Promise((resolve) => requestAnimationFrame(() => resolve(true)))`)
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

test('focus moved mid-flight, by a click or a script, lands the flight first', async () => {
  await browser.load(DESKTOP)
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await browser.animationsDone()
  await browser.evaluate(`scrollTo(0, ${await browser.evaluate<number>(DOCK_AT)}); true`)
  await frames()
  assert.ok((await browser.evaluate<unknown[]>(FLIGHT_NOW)).length > 0, 'no flight')
  await browser.evaluate(`document.querySelector('.ab-search input').focus(); true`)
  await frames()
  assert.deepEqual(await browser.evaluate(FLIGHT_NOW), [], 'still flying')
  assert.notEqual((await browser.evaluate<{ links: string }>(SHOWN)).links, 'none')
})

test('on a phone the bar comes into view in full, never over focus near the top, and never with the intro’s buttons still on the screen', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  // In view: in, it shows on the screen, not still above it.
  await revealBar()
  const seen = await browser.evaluate<{ top: number; bottom: number }>(
    `(({ top, bottom }) => ({ top, bottom }))(document.querySelector('.ab-bar').getBoundingClientRect())`,
  )
  assert.ok(seen.top <= 0 && seen.bottom > 40, `the bar in, at ${seen.top} to ${seen.bottom}px`)
  // The intro's buttons' top above the screen but their bottom still on it: no bar.
  const buttons = await browser.evaluate<{ top: number; height: number }>(`(() => {
    const actions = document.querySelector('.ab-intro-actions')
    let top = 0
    for (let el = actions; el; el = el.offsetParent) top += el.offsetTop
    return { top, height: actions.offsetHeight }
  })()`)
  await scrollAndSettle(buttons.top + 10 + 40)
  await scrollAndSettle(buttons.top + 10)
  assert.equal(
    await browser.evaluate(`document.querySelector('.ab-app').dataset.links`),
    'intro',
    'the buttons partly on the screen',
  )
  // Focus on a trending panel halfway down the page, just below the screen's top, then a scroll
  // up: the bar stays out.
  const panel = `document.querySelectorAll('.ab-grid .ab-link')[4]`
  await browser.evaluate(`${panel}.scrollIntoView({ block: 'start', behavior: 'instant' }); true`)
  await frames()
  const target = await browser.evaluate<number>(
    `scrollY + ${panel}.getBoundingClientRect().top - 5`,
  )
  await scrollAndSettle(target + 40)
  await browser.evaluate(`${panel}.focus({ preventScroll: true }); true`)
  await frames()
  await scrollAndSettle(target)
  const near = await browser.evaluate<{ links: string; top: number }>(
    `({ links: document.querySelector('.ab-app').dataset.links, top: Math.round(${panel}.getBoundingClientRect().top) })`,
  )
  assert.ok(near.top < 30, `the panel isn't near the top (${near.top}px)`)
  assert.notEqual(near.links, 'bar', 'the bar came in over focus')
})

test('a phone bar’s links turn ink when hovered, as the header’s do', async () => {
  await browser.load({ ...PHONE, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.landAll()
  await revealBar()
  await pointAt('.ab-bar a[href="#decades"]')
  const hovered = await browser.evaluate(
    `(({ backgroundColor, color }) => ({ fill: backgroundColor, text: color }))(getComputedStyle(document.querySelector('.ab-bar a[href="#decades"]')))`,
  )
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 800 })
  assert.deepEqual(hovered, { fill: 'rgb(20, 20, 20)', text: 'rgb(255, 255, 255)' })
})
