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
  const wrong = (await browser.evaluate<[number, string][]>(`window.__frames`)).filter(
    ([y, links]) => y >= dockAt + 10 && links !== 'header',
  )
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

test('under 900px, and in the gallery, both sets show as they did', async () => {
  await browser.load({ width: 860, height: 900, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  assert.deepEqual(
    await browser.evaluate(SHOWN),
    { links: 'none', header: true, intro: true },
    '860px',
  )
  await browser.load({ ...DESKTOP, reduceMotion: true, url: new URL('/?gallery', BASE_URL).href })
  assert.ok(await browser.waitFor(`document.querySelector('.ab-top .ab-nav a')`, 10_000))
  assert.equal(
    await browser.evaluate(
      `[...document.querySelectorAll('.ab-top .ab-nav a')].every((a) => getComputedStyle(a).visibility === 'visible')`,
    ),
    true,
    'the gallery',
  )
})
