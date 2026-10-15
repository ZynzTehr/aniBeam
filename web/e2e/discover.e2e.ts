// The Discover page in a real browser: layout, decades, search, the title card, the pull,
// keyboard use, reduced motion and phones. Run with `npm run test:browser` (see browser.ts).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { Browser, type Answer } from './browser.ts'

let browser: Browser

// The decade strip's row of titles (the row of empty cards shown while loading is another one).
const decadeRow = `document.querySelector('[aria-labelledby="decades"] .ab-strip-row:not([aria-hidden])')`
// The search results' titles, joined; and whether the results heading names a search term.
const resultTitles = `[...document.querySelectorAll('.ab-results .ab-strip-panel[href] .ab-strip-title')].map((t) => t.textContent).join(' | ')`
const resultsFor = (term: string) =>
  `document.querySelector('#results')?.textContent.includes(${JSON.stringify(`“${term}”`)})`

/**
 * From now on, lists each results heading the page shows, in order, in window.__headings, so a
 * check sees every search that ran, even one on screen for a moment. Calling it again starts a
 * new list. In this file's browser, unless given another.
 */
async function recordHeadings(page = browser) {
  await page.evaluate(`(() => {
    if (!window.__headings)
      new MutationObserver(() => {
        const heading = document.getElementById('results')?.firstChild?.textContent
        if (heading && heading !== window.__headings.at(-1)) window.__headings.push(heading)
      }).observe(document.querySelector('main'), { childList: true, characterData: true, subtree: true })
    window.__headings = []
    return true
  })()`)
}

// An AniList answer of HTTP 400. A bad request isn't retried, so Try again shows at once (a
// failed connection waits out the AniList client's one-minute pause first).
const BAD_REQUEST = {
  status: 400,
  body: { data: null, errors: [{ message: 'Bad request', status: 400 }] },
}
const failSearches = () =>
  browser.rewriteAniList(({ request }) => (request.variables.search ? BAD_REQUEST : null))
const goOffline = (offline: boolean) =>
  browser.send('Network.emulateNetworkConditions', {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

/**
 * Answers the page's searches for these terms inside the page, each with that many of the sample
 * titles, a moment after it is asked, as AniList would. No request reaches AniList, and each
 * search gets as many titles as a check needs. Other requests go on as usual. It lasts until the
 * page loads again, or until the function it returns puts the page's own fetch back. `held`
 * answers wait for releaseAnswers(), as a late one waits out anilist()'s pause or a slow
 * connection, so a check can stage what the visitor does meanwhile.
 */
async function answerSearches(titles: Record<string, number>, { held = false } = {}) {
  const answers = Object.fromEntries(
    Object.entries(titles).map(([term, count]) => [
      term,
      JSON.stringify({ data: { Page: { media: SAMPLES.slice(0, count) } } }),
    ]),
  )
  await browser.evaluate(`(() => {
    const answers = ${JSON.stringify(answers)}, fetch = window.fetch
    let release
    const released = new Promise((resolve) => (release = resolve))
    if (!${held}) release()
    window.__releaseAnswers = () => {
      release()
      return true
    }
    window.fetch = function (url, init) {
      const answer = url === 'https://graphql.anilist.co' && answers[JSON.parse(init.body).variables.search]
      if (!answer) return fetch.apply(this, arguments)
      const response = new Response(answer, { headers: { 'Content-Type': 'application/json' } })
      return released.then(() => new Promise((resolve) => setTimeout(() => resolve(response), 300)))
    }
    window.__stopAnswering = () => {
      window.fetch = fetch
      return true
    }
    return true
  })()`)
  return () => browser.evaluate('window.__stopAnswering()')
}

/** Lets the answers answerSearches holds go, each a moment later, as ever. */
const releaseAnswers = () => browser.evaluate('window.__releaseAnswers()')

/** Where the checked decade chip is on screen, and what else lateFirstAnswer looks at. */
type Chip = { top: number; inView: boolean; focused: boolean; titles: number; scrollY: number }

/**
 * A new search whose first answer comes late, as after anilist()'s one-minute pause, a slow
 * connection or a retry. The search starts at the top of the page, where its heading and loading
 * state show. Meanwhile the visitor scrolls down to the decades and focuses the checked chip, as
 * Tab would, and only then do the titles arrive. The answer is held inside the page until then
 * (see answerSearches), so no request is sent. Returns the chip as it was just before the titles
 * arrived and once they have.
 */
async function lateFirstAnswer(term: string) {
  const stopAnswering = await answerSearches({ [term]: 20 }, { held: true })
  const titles = `document.querySelectorAll('.ab-results .ab-strip-panel[href]').length`
  // The chip's pill (its radio button is see-through), and the view under the header, or under
  // the top of the screen once a phone's header has scrolled away.
  const chip = `(() => {
    const input = document.querySelector('.ab-eras input:checked'), r = input.nextElementSibling.getBoundingClientRect()
    const below = Math.max(0, document.querySelector('.ab-top').getBoundingClientRect().bottom)
    return { top: r.top, inView: r.top >= below && r.bottom <= innerHeight, focused: document.activeElement === input, titles: ${titles}, scrollY }
  })()`
  try {
    // Pasted, not typed letter by letter: a shorter search run on the way would put its titles on
    // screen to stand in for this one's, which would make this a refinement.
    await browser.evaluate(
      `(() => { const input = document.querySelector('.ab-search input'); input.focus(); input.select(); return true })()`,
    )
    await browser.send('Input.insertText', { text: term })
    assert.ok(
      await browser.waitFor(resultsFor(term), 5_000),
      `the heading for “${term}” never showed`,
    )
    const before = await browser.evaluate<Chip>(`(() => {
      document.getElementById('decades').scrollIntoView()
      document.querySelector('.ab-eras input:checked').focus()
      return ${chip}
    })()`)
    await releaseAnswers()
    assert.ok(
      await browser.waitFor(`${titles} === 20`, 5_000),
      `the titles for “${term}” never came`,
    )
    // Two frames on, so whatever the answer set off has been drawn.
    const after = await browser.evaluate<Chip>(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(${chip}))))`,
    )
    return { before, after }
  } finally {
    await releaseAnswers() // in case the check stopped before it let the answer go
    await stopAnswering()
    await browser.search('')
  }
}

/**
 * Checks a lateFirstAnswer() run: the chip kept focus and stayed where it was on screen. The
 * titles arriving above it make the page taller, and Chrome scrolls on by as much to keep what
 * the visitor sees in place, in whole pixels, so the chip may shift by a fraction of one.
 */
function assertPlaceKept({ before, after }: Awaited<ReturnType<typeof lateFirstAnswer>>) {
  assert.ok(
    before.titles === 0 && before.focused && before.inView,
    `before the answer came: ${JSON.stringify(before)}, not 0 titles with the chip focused and in view`,
  )
  assert.ok(
    after.focused && Math.abs(after.top - before.top) < 1,
    `the late answer moved the page from ${Math.round(before.scrollY)} to ${Math.round(after.scrollY)}px, and the focused chip from ${Math.round(before.top)}px to ${Math.round(after.top)}px on screen${after.focused ? '' : ', and took its focus'}`,
  )
}

/** Waits until the decade row stops scrolling (snapping animates), so nothing is measured mid-slide. */
async function rowSettled() {
  let last = -1
  for (let settle = 0; settle < 20; settle++) {
    await sleep(100)
    const now = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    if (now === last) return
    last = now
  }
}

/**
 * Tabs from the checked decade chip through the strip's panels, then Shift+Tabs back to the
 * first. For each focused panel: how much of it shows inside the row, and whether its focus
 * ring (4px plus a 3px gap) is cut off.
 */
async function tabThroughStrip() {
  await browser.animationsDone() // the panels pop in; measure them once they have landed
  await browser.evaluate(`document.querySelector('.ab-eras input:checked').focus(); true`)
  const seen: { panel: number; back: boolean; visible: number; ringCut: boolean }[] = []
  for (const back of [false, true]) {
    for (let i = 0; i < 20; i++) {
      await browser.press('Tab', back)
      await rowSettled()
      const step = await browser.evaluate<{
        panel: number
        visible: number
        ringCut: boolean
      } | null>(`(() => {
        const panel = document.activeElement
        if (!panel.matches('.ab-strip-row .ab-strip-panel')) return null
        const p = panel.getBoundingClientRect(), row = panel.closest('.ab-strip-row').getBoundingClientRect()
        const visible = Math.max(0, Math.min(p.right, row.right) - Math.max(p.left, row.left)) / p.width
        const ringCut = p.left - 7 < row.left || p.right + 7 > row.right || p.top - 7 < row.top || p.bottom + 7 > row.bottom
        return { panel: [...panel.closest('.ab-strip-row').children].indexOf(panel.parentElement) + 1, visible: Math.round(visible * 100) / 100, ringCut }
      })()`)
      if (step) seen.push({ ...step, back })
    }
  }
  return seen
}

/** Checks a tabThroughStrip() run: every focused panel shows in full, with its whole ring. */
function assertStripInView(steps: Awaited<ReturnType<typeof tabThroughStrip>>) {
  assert.ok(steps.filter((s) => !s.back).length >= 15, 'too few panels reached by Tab')
  assert.ok(steps.filter((s) => s.back).length >= 15, 'too few panels reached by Shift+Tab')
  const label = (s: (typeof steps)[number]) =>
    `${s.back ? 'Shift+Tab' : 'Tab'} to panel ${s.panel}: ${Math.round(s.visible * 100)}% shown${s.ringCut ? ', ring cut' : ''}`
  const bad = steps.filter((s) => s.visible < 0.95 || s.ringCut).map(label)
  assert.deepEqual(bad, [], 'focused panels out of view or with their ring cut off')
}

// The splash cover's transform. Its parallax moves this span; the img inside zooms on hover.
const splashCover = `getComputedStyle(document.querySelector('.ab-splash .ab-img')).transform`

/**
 * Scrolls the page until that fraction of the splash panel's height has gone off the top of the
 * screen (a negative one leaves its top that far below), then waits two frames, so the
 * scroll-driven parallax has caught up.
 */
async function scrollSplashOut(fraction: number) {
  await browser.evaluate(`(() => {
    const r = document.querySelector('.ab-splash').getBoundingClientRect()
    scrollTo(0, scrollY + r.top + r.height * ${fraction})
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
  })()`)
}

/**
 * The contrast a part of the page shows on screen: between its dark and its light pixels, taken
 * 5% in from each end, so a few stray pixels don't decide it. Computed styles can't show all
 * that a contrast theme paints, such as the plate Chrome puts behind text. The clip is in CSS
 * pixels from the top left of the page, as for Browser.screenshot.
 */
async function pixelContrast(clip: { x: number; y: number; width: number; height: number }) {
  const png = await browser.screenshot(clip)
  // Decoded in the page.
  return browser.evaluate<number>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const lum = []
    for (let i = 0; i < data.length; i += 4) lum.push(0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2]))
    lum.sort((a, b) => a - b)
    const dark = lum[Math.floor(lum.length * 0.05)], light = lum[Math.floor(lum.length * 0.95)]
    return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
  })()`)
}

/**
 * The pixels of part of the page as the screen shows it, as red, green and blue for each pixel,
 * row by row. The clip is in CSS pixels from the top left of the page, as for Browser.screenshot.
 */
async function screenPixels(clip: { x: number; y: number; width: number; height: number }) {
  const png = await browser.screenshot(clip)
  // Decoded in the page.
  return browser.evaluate<{ width: number; rgb: number[] }>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return { width: image.width, rgb: [...data].filter((_, i) => i % 4 !== 3) }
  })()`)
}

/**
 * How much of the screen changed since the last call: the share, in percent, of its pixels whose
 * red, green and blue changed by more than 60 together, the measure the research used for a cut
 * (R1 in its measurements). The screen is taken at half size each way, which keeps it quick and
 * changes the share by about a point, and compared with the last one in the page. With `first`,
 * it only keeps the screen, and returns null.
 */
async function screenChange(first = false) {
  const clip = await browser.evaluate<object>(
    `({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight })`,
  )
  const { data } = await browser.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: 0.5 },
  })
  return browser.evaluate<number | null>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const now = context.getImageData(0, 0, image.width, image.height).data
    const last = window.__lastScreen
    window.__lastScreen = now
    if (${first} || !last) return null
    let changed = 0
    for (let i = 0; i < now.length; i += 4)
      if (Math.abs(now[i] - last[i]) + Math.abs(now[i + 1] - last[i + 1]) + Math.abs(now[i + 2] - last[i + 2]) > 60) changed++
    return Math.round((changed / (now.length / 4)) * 1000) / 10
  })()`)
}

/** How many pixels are brand hot, within 60 of #ff2d55. */
const hotPixels = ({ rgb }: { rgb: number[] }) =>
  rgb.filter(
    (_, i) => i % 3 === 0 && Math.hypot(rgb[i] - 255, rgb[i + 1] - 45, rgb[i + 2] - 85) < 60,
  ).length

/**
 * What a strip along the middle of a switch's track shows: its knob and the track's fill alone.
 * The contrast between its dark and its light pixels, taken 5% in from each end as in
 * pixelContrast, and the side the knob is on: each pixel goes with the end it is nearer, and the
 * knob is the smaller group.
 */
function knobIn({ width, rgb }: { width: number; rgb: number[] }) {
  const channel = (v: number) => {
    v /= 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const lum: number[] = []
  for (let i = 0; i < rgb.length; i += 3)
    lum.push(0.2126 * channel(rgb[i]) + 0.7152 * channel(rgb[i + 1]) + 0.0722 * channel(rgb[i + 2]))
  const sorted = [...lum].sort((a, b) => a - b)
  const dark = sorted[Math.floor(lum.length * 0.05)]
  const light = sorted[Math.floor(lum.length * 0.95)]
  const darker: number[] = []
  const lighter: number[] = []
  lum.forEach((l, i) => (l - dark < light - l ? darker : lighter).push(i % width))
  const knob = darker.length < lighter.length ? darker : lighter
  const middle = knob.reduce((sum, x) => sum + x, 0) / knob.length
  return {
    contrast: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100,
    side: middle < width / 2 ? 'left' : 'right',
  }
}

// The footer's Reduce motion switch: a native checkbox with role="switch". The span after it, in
// its label, is the chip that shows it, with the track and its knob inside.
const motionSwitch = `document.querySelector('.ab-foot input[role="switch"]')`
const hasSwitch = () => browser.evaluate<boolean>(`Boolean(${motionSwitch})`)

// A strip along the middle of the Reduce motion switch's track, where only the track's fill and
// its knob show, for knobIn: inside the track's border (the chip's ::before, placed in the chip's
// padding box), 6px tall and 1px in from each end, in CSS pixels from the top left of the page.
const knobStrip = `((chip) => {
  const style = getComputedStyle(chip), track = getComputedStyle(chip, '::before')
  const r = chip.getBoundingClientRect(), px = parseFloat
  const left = r.left + scrollX + px(style.borderLeftWidth) + px(track.left) + px(track.marginLeft) + px(track.borderLeftWidth)
  const middle = r.top + scrollY + px(style.borderTopWidth) + px(track.top) + px(track.marginTop) + px(track.height) / 2
  return { x: Math.round(left) + 1, y: Math.round(middle) - 3, width: Math.round(px(track.width) - 2 * px(track.borderLeftWidth)) - 2, height: 6 }
})(${motionSwitch}.nextElementSibling)`

/**
 * Brings keyboard focus to the Reduce motion switch as a keyboard user arrives, so it shows its
 * ring (:focus-visible): Shift+Tab out of it, then Tab back in.
 */
async function tabToSwitch() {
  await browser.evaluate(`${motionSwitch}.focus(); true`)
  await browser.press('Tab', true)
  await browser.press('Tab')
}

/** Clicks the middle of the Reduce motion switch's chip with the mouse, then moves the mouse away. */
async function clickSwitch() {
  const at = await browser.evaluate<{ x: number; y: number }>(`(async () => {
    const chip = ${motionSwitch}.nextElementSibling
    chip.scrollIntoView({ block: 'center' })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const r = chip.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  for (const type of ['mousePressed', 'mouseReleased'])
    await browser.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 })
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
}

// The line beside the Reduce motion switch that says why it is locked, if one shows, as far as
// checkVisibility() can tell: a line clipped to a pixel, as sr-only clips it, still passes (see
// readWhyLine). The locked check must find it, so the unlocked one, which must not, can't pass by
// looking in the wrong place.
const whyLine = `[...document.querySelectorAll('.ab-foot .ab-motion-why')].find((line) => line.checkVisibility())`

/**
 * What a screen reader reads out after the Reduce motion switch's name and state: its
 * description, as Chrome's accessibility tree gives it, or null if it has none. aria-describedby
 * reads a line out even while the line is hidden, so only the tree can say what is heard.
 */
async function switchDescription(): Promise<string | null> {
  const { result } = await browser.send('Runtime.evaluate', { expression: motionSwitch })
  const { nodes } = await browser.send('Accessibility.getPartialAXTree', {
    objectId: result.objectId,
    fetchRelatives: false,
  })
  return nodes[0]?.description?.value || null
}

/**
 * The Reduce motion switch as the page shows it, two frames after it is scrolled to the middle of
 * the screen: whether it is on, locked (aria-disabled) and focused from the keyboard; the line
 * that says why it is locked, if one shows, and the description a screen reader reads out with
 * the switch (see switchDescription); its chip's fill, border, shadow and lift; the site's
 * setting on <html> and the choice saved for later visits; the brand-hot pixels within 10px of
 * the chip, its focus ring; its knob as the screen shows it (see knobStrip and knobIn): the side
 * it is on if it stands out from its track at 3:1 or better, or else the contrast it shows; and
 * the transitions its knob (the chip's ::after) ran since the last time this was asked.
 */
async function readSwitch() {
  const state = await browser.evaluate<{
    checked: boolean
    locked: string | null
    focused: boolean
    why: string | null
    look: { fill: string; border: string; shadow: string; lift: string }
    motion: string | null
    saved: string | null
    slid: string[]
    around: { x: number; y: number; width: number; height: number }
    track: { x: number; y: number; width: number; height: number }
  }>(`(async () => {
    const input = ${motionSwitch}, chip = input.nextElementSibling
    if (!window.__slid) {
      window.__slid = []
      addEventListener('transitionrun', (event) => {
        if (event.target === chip && event.pseudoElement === '::after') window.__slid.push(event.propertyName)
      }, true)
    }
    chip.scrollIntoView({ block: 'center' })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const why = ${whyLine}
    const style = getComputedStyle(chip), r = chip.getBoundingClientRect()
    const x = Math.floor(r.left + scrollX) - 10, y = Math.floor(r.top + scrollY) - 10
    return {
      checked: input.checked,
      locked: input.getAttribute('aria-disabled'),
      focused: document.activeElement === input && input.matches(':focus-visible'),
      why: why?.textContent ?? null,
      look: { fill: style.backgroundColor, border: style.borderTopStyle, shadow: style.boxShadow, lift: style.transform },
      motion: document.documentElement.dataset.motion ?? null,
      saved: localStorage.getItem('anibeam:motion'),
      slid: window.__slid.splice(0),
      around: { x, y, width: Math.ceil(r.right + scrollX) + 10 - x, height: Math.ceil(r.bottom + scrollY) + 10 - y },
      track: ${knobStrip},
    }
  })()`)
  const hot = hotPixels(await screenPixels(state.around))
  // knobIn names a side even for a knob too faint to see, so then only its contrast is given.
  const knob = knobIn(await screenPixels(state.track))
  return {
    ...state,
    ring: hot >= 1000 ? 'brand hot' : `${hot} brand-hot pixels`,
    knob:
      knob.contrast >= 3
        ? `on the ${knob.side} at 3:1 or better`
        : `at ${knob.contrast}:1 against its track`,
    description: await switchDescription(),
  }
}

/**
 * The line that says why the Reduce motion switch is locked, as a sighted visitor sees it, two
 * frames after it is scrolled to the middle of the screen, or null if none shows: its size, its
 * clip-path, and the contrast its text shows on screen (see pixelContrast), each in words if it
 * passes (200x16px or more, none, 4.5:1 or better), or else as measured. That it shows to the
 * page isn't enough: it could still be clipped to a pixel, as sr-only clips it, or too faint.
 */
async function readWhyLine() {
  const line = await browser.evaluate<{
    width: number
    height: number
    clip: string
    text: { x: number; y: number; width: number; height: number }
  } | null>(`(async () => {
    const line = ${whyLine}
    if (!line) return null
    line.scrollIntoView({ block: 'center' })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    // The text's box, in whole pixels from the top left of the page, rounded inward: its edge
    // pixels are partly the page around it.
    const range = document.createRange()
    range.selectNodeContents(line)
    const r = line.getBoundingClientRect(), t = range.getBoundingClientRect()
    const x = Math.ceil(t.left + scrollX), y = Math.ceil(t.top + scrollY)
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      clip: getComputedStyle(line).clipPath,
      text: { x, y, width: Math.floor(t.right + scrollX) - x, height: Math.floor(t.bottom + scrollY) - y },
    }
  })()`)
  if (!line) return null
  // A line with no text has no box to take a picture of, and nothing on screen to read.
  const contrast = line.text.width > 0 && line.text.height > 0 ? await pixelContrast(line.text) : 1
  return {
    size:
      line.width >= 200 && line.height >= 16
        ? '200x16px or more'
        : `${line.width}x${line.height}px`,
    clip: line.clip,
    contrast: contrast >= 4.5 ? '4.5:1 or better' : `${contrast}:1`,
  }
}

/**
 * The Reduce motion switch on a phone `width`px wide, two frames after it is scrolled to the
 * middle of the screen, each part in a few words: whether its target (the label, which its chip
 * fills) shows, 44px tall or more, inside the page's side margins (the footer's padding); where
 * the line that says why it is locked sits, if one shows (see whyLine), or else null: under the
 * chip or not, and inside those margins or past them; and whether the page is any wider than the
 * phone. Phone emulation widens the layout to fit anything too wide, so the page is measured
 * against the phone's width, not innerWidth.
 */
async function readSwitchOnPhone(width: number) {
  const seen = await browser.evaluate<{
    shown: boolean
    height: number
    past: number
    line: { under: boolean; past: number } | null
    wide: number
  }>(`(async () => {
    const target = ${motionSwitch}.closest('label')
    target.scrollIntoView({ block: 'center' })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const foot = document.querySelector('.ab-foot'), f = foot.getBoundingClientRect(), style = getComputedStyle(foot)
    const left = f.left + parseFloat(style.paddingLeft), right = f.right - parseFloat(style.paddingRight)
    // How far a box reaches past the margins, on either side: 0 if it stays inside them.
    const past = (r) => Math.max(0, left - r.left, r.right - right)
    const t = target.getBoundingClientRect(), why = ${whyLine}
    let line = null
    if (why) {
      // The text's own boxes, one per row: text that can't wrap may run past the line's box.
      const text = document.createRange()
      text.selectNodeContents(why)
      line = { under: why.getBoundingClientRect().top >= t.bottom, past: Math.max(0, ...[...text.getClientRects()].map(past)) }
    }
    return {
      shown: target.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      height: t.height,
      past: past(t),
      line,
      wide: Math.max(innerWidth, document.documentElement.scrollWidth),
    }
  })()`)
  const inside = (past: number) =>
    past <= 0.5
      ? 'inside the page’s side margins'
      : `${Math.ceil(past)}px past the page’s side margins`
  return {
    target: seen.shown
      ? `shown, ${seen.height >= 44 ? '44px tall or more' : `${Math.round(seen.height)}px tall`}, ${inside(seen.past)}`
      : 'not shown',
    line:
      seen.line && `${seen.line.under ? 'under' : 'not under'} the chip, ${inside(seen.line.past)}`,
    page: seen.wide <= width ? 'no wider than the phone' : `${seen.wide}px wide`,
  }
}

/**
 * Leaves the keyboard at the top of the page, as a fresh load does: nothing focused, and the next
 * Tab goes to the first link on the page. Blurring isn't enough: Chrome's next Tab goes on from
 * the element that had focus, or from where the last link jumped to. So a stand-in put before
 * everything else on the page takes focus, and goes.
 */
const fromTheTop = () =>
  browser.evaluate(`(() => {
    const start = document.createElement('div')
    start.tabIndex = -1
    document.body.prepend(start)
    start.focus()
    start.remove()
    scrollTo(0, 0)
    return true
  })()`)

/**
 * Where keyboard focus is, two frames after a key, in a few words: what has it (a link by its
 * text, or the Reduce motion switch, on or off), and whether it shows as focused from the
 * keyboard (:focus-visible); its ring, in brand-hot pixels within 10px of what draws it (the
 * link, or the switch's chip); whether that and its ring are wholly in view, with nothing drawn
 * over them; and the skip links on screen.
 */
async function readFocus() {
  const state = await browser.evaluate<{
    name: string
    place?: string
    around: { x: number; y: number; width: number; height: number } | null
    links: string[]
  }>(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const focused = document.activeElement, toggle = ${motionSwitch}
    const links = [...document.querySelectorAll('a')].filter((a) => {
      const r = a.getBoundingClientRect()
      return a.textContent.startsWith('Skip to') && r.bottom > 0 && r.top < innerHeight
    }).map((a) => a.textContent)
    if (!focused || focused === document.body) return { name: 'nothing', around: null, links }
    let name = focused.textContent.trim() || focused.tagName.toLowerCase()
    if (focused === toggle) name = 'the Reduce motion switch (' + (toggle.checked ? 'on' : 'off') + ')'
    if (!focused.matches(':focus-visible')) name += ' (not :focus-visible)'
    // What draws the ring (the link, or the switch's chip), and the ring, 4px wide and 3px out.
    const shown = focused === toggle ? toggle.nextElementSibling : focused
    const r = shown.getBoundingClientRect()
    const [top, left, bottom, right] = [r.top - 7, r.left - 7, r.bottom + 7, r.right + 7]
    const whole = top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth
    const gone = bottom <= 0 || top >= innerHeight || right <= 0 || left >= innerWidth
    // What the screen shows at its middle: itself, unless something is drawn over it.
    const over = whole && document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
    let place = 'in view'
    if (gone) place = 'out of view'
    else if (!whole) place = 'partly out of view'
    else if (!shown.contains(over))
      place = 'under ' + (over.closest('[class]')?.classList[0] ?? over.tagName.toLowerCase())
    const x = Math.max(0, Math.floor(r.left + scrollX) - 10)
    const y = Math.max(0, Math.floor(r.top + scrollY) - 10)
    const width = Math.ceil(r.right + scrollX) + 10 - x
    const height = Math.ceil(r.bottom + scrollY) + 10 - y
    return { name, place, around: { x, y, width, height }, links }
  })()`)
  const links = `skip links on screen: ${state.links.join(', ') || 'none'}`
  if (!state.around) return `${state.name}; ${links}`
  const hot = hotPixels(await screenPixels(state.around))
  const ring = hot >= 1000 ? 'brand hot' : `${hot} brand-hot pixels`
  return `${state.name}, ring ${ring}, ${state.place}; ${links}`
}

// Starts a load of the page with `go` and lists the parts of the intro that moved after they were
// drawn, as Chrome reports them in its layout shifts from the very start ("part: from → to").
// The intro fills the screen under the header, so it needs the header's height, which SiteHeader
// publishes as --top-h; until it was published, the intro was sized by the CSS fallback, 80px.
async function introMoves(go: () => Promise<unknown>) {
  const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__shifts = []
      new PerformanceObserver((list) => window.__shifts.push(...list.getEntries())).observe({ type: 'layout-shift', buffered: true })`,
  })
  try {
    await go()
    assert.ok(await browser.titlesShown())
    await browser.animationsDone()
    return await browser.evaluate<string[]>(`(() => {
      const intro = document.querySelector('.ab-intro')
      return window.__shifts.flatMap((shift) =>
        shift.sources
          .filter((source) => source.node && intro.contains(source.node))
          .map((source) => (source.node.className || source.node.nodeName.toLowerCase()) + ': ' + Math.round(source.previousRect.top) + ' → ' + Math.round(source.currentRect.top) + 'px'),
      )
    })()`)
  } finally {
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
  }
}
const introMovesOnLoad = (options: Parameters<Browser['load']>[0]) =>
  introMoves(() => browser.load(options))
// The same for a reload of the page as it is. Browser.load navigates, which the page counts as
// a new visit, never as a reload, so this reloads the way the browser's button does.
const introMovesOnReload = () =>
  introMoves(async () => {
    await browser.evaluate('window.__beforeReload = true; true')
    await browser.send('Page.reload')
    await browser.waitFor(
      `!window.__beforeReload && document.readyState === 'complete' && document.querySelector('#main')`,
      30_000,
    )
    await browser.evaluate('document.fonts.ready.then(() => true)')
  })

before(async () => {
  browser = await Browser.open()
})
after(() => browser?.close())

describe('desktop (1440x900)', () => {
  // What the page asks AniList for on its first load, a first visit: the profile is new.
  const firstVisit: Answer['request'][] = []
  before(async () => {
    await browser.rewriteAniList(({ request }) => {
      firstVisit.push(request)
      return null
    })
    try {
      await browser.load()
      assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
    } finally {
      await browser.rewriteAniList(null)
    }
  })

  // AniList allows 30 requests a minute per IP address, and a class on one Wi-Fi shares one.
  test('a first visit asks AniList for trending and the 1990s in one request', () => {
    // Each request, as the lists it asks for. A decade is named by its first year: its `from`
    // is the YYYYMMDD date just before it.
    const lists = firstVisit.map(({ query, variables }) => [
      ...(query.includes('TRENDING_DESC') ? ['trending'] : []),
      ...(query.includes('POPULARITY_DESC')
        ? [`${Math.ceil(Number(variables.from) / 10000)}s`]
        : []),
    ])
    assert.deepEqual(lists, [['trending', '1990s']], 'the lists each request asked AniList for')
  })

  test('renders the header, intro, nine trending panels, the pull and the decades', async () => {
    const page = await browser.evaluate<{
      h1: string
      links: string[]
      panels: number
      chips: string[]
    }>(`({
      h1: document.querySelector('h1').textContent.replace('キラーン', '').replace(/\\s+/g, ' ').trim(),
      links: [...document.querySelectorAll('.ab-nav a')].map((a) => a.textContent.trim()),
      panels: document.querySelectorAll('.ab-grid .ab-link').length,
      chips: [...document.querySelectorAll('.ab-eras input')].map((input) => input.value),
    })`)
    assert.equal(page.h1, 'What’s hot. What’s new. Talk about it.')
    assert.deepEqual(page.links, ['Trending', 'Pull', 'Decades'])
    assert.equal(page.panels, 9)
    assert.deepEqual(page.chips, [
      'pre-1970',
      '1970s',
      '1980s',
      '1990s',
      '2000s',
      '2010s',
      '2020s',
      'upcoming',
    ])
  })

  test('the intro fills the first screen, and status lines stay quiet once titles show', async () => {
    const state = await browser.evaluate<{ trendingTop: number; notes: string[] }>(`({
      trendingTop: document.querySelector('.ab-page').getBoundingClientRect().top,
      notes: [...document.querySelectorAll('.ab-note')].map((note) => note.textContent),
    })`)
    // At the fold, not just below it: an intro sized without the header's height (--top-h) ran
    // 78px past it.
    assert.ok(
      Math.abs(state.trendingTop - 900) <= 1,
      `trending starts at ${state.trendingTop}px, not at the fold (900px)`,
    )
    assert.deepEqual(state.notes, ['', ''])
  })

  test('later features show as coming soon and cannot be used', async () => {
    const soon = await browser.evaluate<{
      menu: string
      tabIndex: number
      hint: string
      intro: string
    }>(`({
      menu: document.querySelector('.ab-nav .ab-soon').textContent.replace(/\\s+/g, ' ').trim(),
      tabIndex: document.querySelector('.ab-nav .ab-soon').tabIndex,
      hint: document.querySelector('.ab-hint').textContent,
      intro: document.querySelector('.ab-intro-lede').textContent,
    })`)
    assert.equal(soon.menu, 'My List Soon')
    assert.equal(soon.tabIndex, -1)
    assert.match(soon.hint, /Coming soon: mood sliders/)
    assert.match(soon.intro, /Coming soon: chat with other fans/)
  })

  test('the first Tab reaches a visible skip link that jumps to the page', async () => {
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    await browser.press('Tab')
    const skip = await browser.evaluate<{ text: string; shown: boolean }>(
      `({ text: document.activeElement.textContent.trim(), shown: getComputedStyle(document.activeElement).transform === 'none' })`,
    )
    assert.deepEqual(skip, { text: 'Skip to content', shown: true })
    await browser.press('Enter')
    assert.equal(await browser.evaluate('location.hash'), '#main')
  })

  test('the second Tab reaches a visible skip link that focuses the Reduce motion switch in view', async () => {
    // The switch sits in the footer, past every title on the page, some 40 Tab stops in. So a
    // second skip link, after "Skip to content" and in its place, takes keyboard users there: its
    // Enter must focus the switch, for Space to turn it on, and bring it into view with its
    // brand-hot ring. Each skip link shows only while it has focus. Each step says in a few words
    // what has focus, its ring (1,500 to 2,000 brand-hot pixels for a whole one here, and 0 for
    // none), whether it is in view, and the skip links on screen.
    await fromTheTop()
    const tabs: string[] = []
    for (let press = 0; press < 2; press++) {
      await browser.press('Tab')
      tabs.push(await readFocus())
    }
    assert.deepEqual(
      tabs,
      [
        'Skip to content, ring brand hot, in view; skip links on screen: Skip to content',
        'Skip to Reduce motion, ring brand hot, in view; skip links on screen: Skip to Reduce motion',
      ],
      'what the first and the second Tab from the top of the page focused',
    )
    // Enter only once the link has focus: on the logo, say, it would leave the page.
    await browser.press('Enter')
    const jumped = await readFocus()
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    assert.equal(
      jumped,
      'the Reduce motion switch (off), ring brand hot, in view; skip links on screen: none',
      'what Enter on “Skip to Reduce motion” focused',
    )
  })

  test('picking the 1980s chip swaps the strip to 1980s titles', async () => {
    const first = `document.querySelector('.ab-strip-row .ab-strip-panel[href] .ab-strip-title')?.textContent`
    const nineties = await browser.evaluate<string>(first)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    assert.ok(
      await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(nineties)}`),
      'the strip kept the 1990s titles',
    )
    assert.equal(
      await browser.evaluate(`document.querySelector('.ab-eras input:checked').value`),
      '1980s',
    )
  })

  test('searching shows results in place of the intro, and Esc returns focus to the opened result', async () => {
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`),
      'no results appeared',
    )
    const results = await browser.evaluate<{
      heading: string
      first: string
      intro: boolean
      scrollY: number
    }>(`({
      heading: document.querySelector('.ab-results h2, .ab-results h1').textContent.replace('サーチ!', '').trim(),
      first: document.querySelector('.ab-results .ab-strip-title').textContent,
      intro: Boolean(document.querySelector('.ab-intro')),
      scrollY,
    })`)
    assert.equal(results.heading, 'Results for “frieren”')
    assert.match(results.first, /Frieren/i)
    assert.equal(results.intro, false)
    assert.equal(results.scrollY, 0)

    await browser.evaluate(
      `document.querySelector('.ab-results .ab-strip-panel[href]').focus(); true`,
    )
    await browser.press('Enter')
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5_000),
      'the title card did not open',
    )
    await sleep(1_800)
    const card = await browser.evaluate<{ title: string; soon: string[] }>(`({
      title: document.querySelector('#ab-card-title').textContent.replace(/\\s+/g, ' ').trim(),
      soon: [...document.querySelectorAll('.ab-card button.ab-soon')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim() + (b.disabled ? ' (disabled)' : '')),
    })`)
    assert.match(card.title, /Frieren/i)
    assert.deepEqual(card.soon, [
      'Save to My List Soon (disabled)',
      'Chat about it Soon (disabled)',
    ])
    await browser.press('Escape')
    // With motion allowed, the card plays its opening backwards before it closes.
    await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000)
    const back = await browser.evaluate<{ open: boolean; focus: string }>(
      `({ open: Boolean(document.querySelector('dialog.ab-card')), focus: document.activeElement.className })`,
    )
    assert.deepEqual(back, { open: false, focus: 'ab-strip-panel' })
  })

  test('the page has one h1: the intro’s title, or the results heading while searching', async () => {
    // Screen readers jump to a page's h1 to learn what the page is about. Search results take
    // the intro's place, so they take its h1 too. The check above searched "frieren", so this
    // one needs no recording of its own.
    const h1s = `[...document.querySelectorAll('h1')].map((h) => h.id)`
    await browser.search('')
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-intro')`, 5_000),
      'the intro did not come back',
    )
    const home = await browser.evaluate<string[]>(h1s)
    await browser.search('frieren')
    assert.ok(await browser.waitFor(resultsFor('frieren'), 5_000), 'the heading never showed')
    const searching = await browser.evaluate<string[]>(h1s)
    await browser.search('')
    assert.deepEqual(
      home,
      ['ab-intro-title'],
      'at home, the intro’s title is not the page’s one h1',
    )
    assert.deepEqual(
      searching,
      ['results'],
      'while searching, the results heading is not the page’s one h1',
    )
  })

  test('a search with no matches says so, and clearing it brings the intro back', async () => {
    await browser.search('zzqqxxnotananime')
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-results .ab-note')?.textContent === 'No titles found.'`,
      ),
      'no "No titles found." line',
    )
    await browser.search('')
    assert.ok(
      await browser.waitFor(
        `document.querySelector('.ab-intro') && !document.querySelector('.ab-results')`,
        5_000,
      ),
      'the intro did not come back',
    )
  })

  test('a different search, typed over the last or after clearing it, never shows the old titles while it loads', async () => {
    await browser.search('frieren')
    assert.ok(await browser.waitFor(`/Frieren/i.test(${resultTitles})`), 'no Frieren results')

    // Typed straight over: the box never empties, so the results stay on the page throughout.
    await browser.holdAniList(3_000)
    await browser.search('mushishi')
    assert.ok(await browser.waitFor(resultsFor('mushishi'), 5_000), 'the heading never switched')
    const typedOver = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.doesNotMatch(typedOver, /Frieren/i, 'the last search’s titles showed under the new one')
    assert.ok(await browser.waitFor(`/mushi-?shi/i.test(${resultTitles})`), 'no Mushishi results') // English title: MUSHI-SHI

    // Cleared first: a new search starts from nothing, even one that "mushishi" starts with.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await browser.holdAniList(3_000)
    await browser.search('mushi')
    assert.ok(await browser.waitFor(resultsFor('mushi'), 5_000), 'the heading never switched')
    const afterClear = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.equal(afterClear, '', 'the cleared search’s titles came back')
    await browser.search('')
  })

  test('refining a search keeps its titles on screen, and the visitor’s place, while it loads', async () => {
    await browser.search('mushishi')
    assert.ok(await browser.waitFor(`/mushi-?shi/i.test(${resultTitles})`), 'no Mushishi results')
    await browser.evaluate('scrollTo(0, 300); true')
    await browser.holdAniList(3_000)
    await browser.search('mushishi zoku')
    assert.ok(
      await browser.waitFor(resultsFor('mushishi zoku'), 5_000),
      'the heading never switched',
    )
    const refining = await browser.evaluate<{ titles: string; scrollY: number }>(
      `({ titles: ${resultTitles}, scrollY })`,
    )
    await browser.holdAniList(0)
    assert.match(
      refining.titles,
      /mushi-?shi/i,
      'the titles emptied while the refined search loaded',
    )
    assert.equal(refining.scrollY, 300, 'refining the search moved the page')
    await browser.search('')
  })

  test('a refinement typed from below the results brings them back into view', async () => {
    // Both searches were made by the check above, so this one needs no recording of its own.
    // Where the results heading is, and the part of the view below the header.
    const heading = () =>
      browser.evaluate<{ top: number; below: number; bottom: number }>(`({
        top: document.getElementById('results').getBoundingClientRect().top,
        below: document.querySelector('.ab-top').getBoundingClientRect().bottom,
        bottom: innerHeight,
      })`)
    // Wait for this search's own heading: the check above has just cleared “mushishi zoku”,
    // whose results show until the box has been still for 300 ms.
    await browser.search('mushishi')
    assert.ok(
      await browser.waitFor(`${resultsFor('mushishi')} && /mushi-?shi/i.test(${resultTitles})`),
      'no Mushishi results',
    )
    // Where the header's Trending link lands, the results end behind the header.
    await browser.evaluate(`document.getElementById('ab-trending').scrollIntoView(); true`)
    const end = await browser.evaluate<number>(
      `document.querySelector('.ab-results').getBoundingClientRect().bottom`,
    )
    await browser.search('mushishi zoku') // letters added
    assert.ok(
      await browser.waitFor(resultsFor('mushishi zoku'), 5_000),
      'the heading never switched',
    )
    const added = await heading()
    // Far below the results, at the pull.
    await browser.evaluate(`document.getElementById('pull').scrollIntoView(); true`)
    await browser.search('mushishi') // letters removed
    assert.ok(await browser.waitFor(resultsFor('mushishi'), 5_000), 'the heading never switched')
    const removed = await heading()
    await browser.search('')
    assert.ok(
      end > 0 && end <= added.below,
      `where the Trending link lands, the results end at ${Math.round(end)}px, not behind the header (0 to ${Math.round(added.below)}px)`,
    )
    const outOfView = [
      { typed: '“mushishi zoku” typed where the Trending link lands', ...added },
      { typed: '“mushishi” typed at the pull', ...removed },
    ]
      .filter((at) => at.top < at.below || at.top >= at.bottom)
      .map(
        (at) =>
          `${at.typed}: heading at ${Math.round(at.top)}px, view ${Math.round(at.below)}px to ${at.bottom}px`,
      )
    assert.deepEqual(
      outOfView,
      [],
      'a refinement typed from below the results left them out of view',
    )
  })

  test('a refinement brings its titles into view when fewer arrive than stood in for them, and stays put while some show', async () => {
    // These searches are answered inside the page with sample titles (see answerSearches), so
    // this check sends no request, and each search gets the titles it needs: 20 fill three rows
    // at this width, 8 fill one. Each answer comes a moment after its search, as AniList's does,
    // and until then the titles of the search it refines stand in for it. A saved answer would
    // show at once, with the search.
    const stopAnswering = await answerSearches({
      gundam: 20,
      'gundam 00': 8,
      'gundam wing': 3,
      'gundam win': 4,
    })
    const titles = `[...document.querySelectorAll('.ab-results .ab-strip-panel[href]')]`
    // Where each title ends up: its list item, as its panel pops in from a smaller size.
    const items = `${titles}.map((panel) => panel.parentElement.getBoundingClientRect())`
    const header = `document.querySelector('.ab-top').getBoundingClientRect().bottom`
    // How many titles show in full between the header and the bottom of the screen, and where
    // they all are.
    type Shown = { whole: number; top: number; end: number; below: number; bottom: number }
    const shown = `(() => {
      const below = ${header}, all = ${items}
      const whole = all.filter((r) => r.top >= below && r.bottom <= innerHeight).length
      return { whole, top: all[0].top, end: all.at(-1).bottom, below, bottom: innerHeight }
    })()`
    // Types a search, then waits for its answer: that many titles.
    const answered = async (term: string, count: number) => {
      await browser.search(term)
      return browser.waitFor(`${resultsFor(term)} && ${titles}.length === ${count}`, 5_000)
    }
    try {
      assert.ok(await answered('gundam', 20), 'the titles for “gundam” never showed')
      // 300px down, as in the refining check, the first row still shows under the header, and
      // the 8 refined titles fill that row.
      await browser.evaluate('scrollTo(0, 300); true')
      assert.ok(await answered('gundam 00', 8), 'the titles for “gundam 00” never showed')
      const stayed = await browser.evaluate<number>('scrollY')
      // The last row just under the header, the rows above it out of view: a shorter answer's
      // one row ends up where the first is, above the view. "gundam" is saved, so it shows at once.
      assert.ok(await answered('gundam', 20), 'the titles for “gundam” never came back')
      const lastRow = await browser.evaluate<{ first: number; below: number }>(`(() => {
        scrollBy(0, ${items}.at(-1).top - ${header} - 32)
        return { first: ${items}[0].bottom, below: ${header} }
      })()`)
      assert.ok(await answered('gundam wing', 3), 'the titles for “gundam wing” never showed')
      const fewer = await browser.evaluate<Shown>(shown)
      // The titles ending halfway behind the header: below it shows only the results' empty end
      // (they fill at least a screen).
      const behind = await browser.evaluate<{
        end: number
        results: number
        below: number
      }>(`(() => {
        scrollBy(0, ${items}.at(-1).bottom - ${header} / 2)
        return {
          end: ${items}.at(-1).bottom,
          results: document.querySelector('.ab-results').getBoundingClientRect().bottom,
          below: ${header},
        }
      })()`)
      assert.ok(await answered('gundam win', 4), 'the titles for “gundam win” never showed')
      const hidden = await browser.evaluate<Shown>(shown)

      assert.equal(
        stayed,
        300,
        'refining the search moved the page by the time its titles arrived, though some were in view',
      )
      assert.ok(
        lastRow.first <= lastRow.below,
        `with the last row under the header, the first ends at ${Math.round(lastRow.first)}px, not above the header (${Math.round(lastRow.below)}px)`,
      )
      assert.ok(
        behind.end > 0 && behind.end <= behind.below && behind.results > behind.below,
        `the titles end at ${Math.round(behind.end)}px and the results at ${Math.round(behind.results)}px: not behind the header and below it (${Math.round(behind.below)}px)`,
      )
      const outOfView = [
        {
          typed: '“gundam wing” (3 titles) typed with the last row of 20 under the header',
          ...fewer,
        },
        { typed: '“gundam win” typed with the titles ending behind the header', ...hidden },
      ]
        .filter((at) => !at.whole)
        .map(
          (at) =>
            `${at.typed}: titles at ${Math.round(at.top)}px to ${Math.round(at.end)}px, view ${Math.round(at.below)}px to ${at.bottom}px`,
        )
      assert.deepEqual(outOfView, [], 'a refinement left its titles out of view once they arrived')
    } finally {
      await stopAnswering()
      await browser.search('')
    }
  })

  test('a new search’s first answer, arriving late, leaves the visitor’s place and focused chip where they were', async () => {
    // Only a refinement's titles, arriving where others stood in for them, may move the page
    // (see the check above). A new search started at the top when it was typed, and the visitor
    // may have moved on since. Its answer is held inside the page (see lateFirstAnswer), so this
    // check sends no request.
    assertPlaceKept(await lateFirstAnswer('macross'))
  })

  test('a typed space restarts the search’s pause, so two words typed at an easy pace search once', async () => {
    // "mushishi", 200 ms, a space, 200 ms, "zoku", then a second: each pause before "zoku" is
    // shorter than the 300 ms one that starts a search, so only "mushishi zoku" should be
    // searched. The pauses are timed on the page's own clock, stopped and moved on by the check:
    // real pauses stretch and shrink on a busy machine, enough to miss a search that ran too
    // soon in about 1 run of 6. A stopped clock can't start again (see Browser.stopClock), so
    // the check opens a browser of its own. AniList is blocked there: the results heading shows
    // as soon as a search starts, so no answer is needed, and no request is sent.
    const own = await Browser.open()
    try {
      await own.blockAniList()
      await own.load()
      await own.animationsDone()
      await recordHeadings(own)
      await own.evaluate(`document.querySelector('.ab-search input').focus(); true`)
      await own.stopClock()
      const type = async (text: string) => {
        for (const character of text) await own.send('Input.insertText', { text: character })
      }
      await type('mushishi')
      await own.tick(200)
      await type(' ')
      await own.tick(200)
      await type('zoku')
      await own.tick(1000)
      assert.ok(await own.waitFor(resultsFor('mushishi zoku'), 5_000), 'the heading never showed')
      assert.deepEqual(
        await own.evaluate<string[]>('window.__headings'),
        ['Results for “mushishi zoku”'],
        'a search ran while the visitor was still typing',
      )
    } finally {
      await own.close()
    }
  })

  test('with an input method, Japanese is searched once each word is converted, and Latin letters as they are typed', async () => {
    // A Japanese input method shows a word as kana, then as candidate words, until the visitor
    // picks one. Searching any of those would be searching for a word nobody typed. The checks
    // above searched "frieren", so only 進撃の巨人 and "進撃の巨人 final" need a recording each.
    const box = `document.querySelector('.ab-search input')`
    // Each step is sent 100 ms after the one before: well within the 300 ms pause that starts a
    // search, while a run of steps lasts longer than that pause.
    let sent = 0
    const step = async (method: string, params: object) => {
      await sleep(Math.max(0, sent + 100 - performance.now()))
      sent = performance.now()
      await browser.send(method, params)
    }
    const compose = async (...texts: string[]) => {
      for (const text of texts)
        await step('Input.imeSetComposition', {
          text,
          selectionStart: text.length,
          selectionEnd: text.length,
        })
    }
    const commit = (text: string) => step('Input.insertText', { text })

    // しんげき with a pause, a wrong candidate with a pause, then 進撃 picked and の巨人 typed
    // straight after it: one search, for the whole title.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await recordHeadings()
    await browser.evaluate(`${box}.focus(); true`)
    await compose('s', 'sh', 'し', 'しn', 'しん', 'しんg', 'しんげ', 'しんげk', 'しんげき')
    const kana = await browser.evaluate<string>(`${box}.value`)
    await sleep(700)
    await compose('神撃')
    await sleep(700)
    await compose('進撃')
    await commit('進撃')
    await compose('n', 'の', 'のk', 'のky', 'のきょ')
    await compose('のきょj', 'のきょじ', 'のきょじn', 'のきょじん', 'の巨人')
    await commit('の巨人')
    const converted = await browser.waitFor(resultsFor('進撃の巨人'), 5_000)
    const headings = await browser.evaluate<string[]>('window.__headings')

    // Only the word being composed is judged, so a Latin word composed after 進撃の巨人, as
    // Android keyboards compose it, is searched as typed too.
    await commit(' ')
    await compose('f', 'fi', 'fin', 'fina', 'final')
    const mixed = await browser.waitFor(resultsFor('進撃の巨人 final'), 5_000)
    await compose('') // cancels the word

    // A word being converted after a search keeps that search's results on screen.
    await browser.search('frieren')
    assert.ok(await browser.waitFor(`/Frieren/i.test(${resultTitles})`), 'no Frieren results')
    await commit(' ')
    await compose('し', 'しn', 'しん')
    await sleep(700)
    const added = await browser.evaluate<{ heading?: string; frieren: boolean }>(
      `({ heading: document.getElementById('results')?.firstChild?.textContent, frieren: /Frieren/i.test(${resultTitles}) })`,
    )
    await compose('') // cancels the word

    // Android keyboards compose Latin words too: those are searched while still composing.
    await browser.search('')
    assert.ok(await browser.waitFor(`!document.querySelector('.ab-results')`, 5_000))
    await compose('f', 'fr', 'fri', 'frie', 'frier', 'friere', 'frieren')
    const composing = await browser.waitFor(resultsFor('frieren'), 5_000)
    await compose('')
    await browser.search('')

    assert.equal(kana, 'しんげき', 'the box did not show the kana being converted')
    assert.ok(converted, 'the converted title was never searched')
    assert.deepEqual(
      headings,
      ['Results for “進撃の巨人”'],
      'a search ran while a word was still being converted',
    )
    assert.deepEqual(
      added,
      { heading: 'Results for “frieren”', frieren: true },
      'a word being converted replaced the search before it',
    )
    assert.ok(composing, 'Latin letters still being composed were not searched')
    assert.ok(mixed, 'a Latin word composed after a Japanese one was not searched as typed')
  })

  test('a different search shows that it is loading, even when typed from far down the results', async () => {
    const panels = `document.querySelectorAll('.ab-results .ab-strip-panel[href]')`
    await browser.search('naruto')
    assert.ok(await browser.waitFor(`${panels}.length >= 12`), 'too few Naruto results')
    // The header stays on screen here, so the box can be typed in from anywhere on the page.
    await browser.evaluate(`[...${panels}].at(-1).scrollIntoView({ block: 'center' }); true`)
    await browser.holdAniList(3_000)
    await browser.search('dragon ball')
    assert.ok(await browser.waitFor(resultsFor('dragon ball'), 5_000), 'the heading never switched')
    await sleep(100)
    const loading = await browser.evaluate<{ text: string; top: number; below: number }>(`(() => {
      const note = document.querySelector('.ab-results .ab-note'), r = note.getBoundingClientRect()
      return { text: note.textContent, top: r.top, below: document.querySelector('.ab-top').getBoundingClientRect().bottom }
    })()`)
    await browser.holdAniList(0)
    assert.equal(loading.text, 'Loading…')
    assert.ok(
      loading.top >= loading.below && loading.top < 900,
      `the Loading… line is at ${Math.round(loading.top)}px, outside the view under the header (${Math.round(loading.below)}px to 900px)`,
    )
    await browser.search('')
  })

  test('titles that have left the screen stay gone, even for a search they would refine', async () => {
    await browser.search('naruto')
    assert.ok(await browser.waitFor(`/naruto/i.test(${resultTitles})`), 'no Naruto results')
    await browser.holdAniList(3_000)
    await browser.search('dragon')
    assert.ok(await browser.waitFor(resultsFor('dragon'), 5_000), 'the heading never switched')
    await browser.search('nar') // "naruto" refines "nar", but its titles are no longer on screen
    assert.ok(await browser.waitFor(resultsFor('nar'), 5_000), 'the heading never switched')
    const titles = await browser.evaluate<string>(resultTitles)
    await browser.holdAniList(0)
    assert.equal(titles, '', 'the Naruto titles came back under “nar”')
    await browser.search('')
  })

  test('Try again hands focus to the heading only when it goes while focused, never while it stays', async () => {
    // A returning visitor whose saved trending titles are over 30 minutes old: the page
    // refreshes them, and AniList turns the refresh down. The saved titles stay on screen.
    await sleep(1_500) // the saved copy updates within a second of the page's last change
    await browser.evaluate(`(() => {
      const saved = JSON.parse(localStorage.getItem('anibeam:cache'))
      for (const query of saved.clientState.queries) query.state.dataUpdatedAt -= 60 * 60 * 1000
      localStorage.setItem('anibeam:cache', JSON.stringify(saved))
      return true
    })()`)
    await browser.rewriteAniList(() => BAD_REQUEST)
    await browser.load()
    const retry = `document.querySelector('.ab-page .ab-retry')`
    const note = `document.querySelector('.ab-page .ab-note').textContent`
    assert.ok(await browser.waitFor(retry), 'no Try again over the saved titles')
    await goOffline(true)
    await browser.evaluate(`${retry}.focus(); true`)
    await browser.press('Enter') // TanStack holds the refresh until the connection is back
    await sleep(300)
    const offline = await browser.evaluate<{ focus: string; note: string }>(
      `({ focus: document.activeElement.className, note: ${note} })`,
    )
    await goOffline(false) // the held refresh runs, and the button hides while it does
    const moved = await browser.waitFor(`document.activeElement.id === 'ab-trending'`, 5_000)
    // AniList turns it down again, and the button comes back. This time it goes while the
    // visitor is in the search box, which keeps focus.
    assert.ok(await browser.waitFor(retry), 'Try again did not come back')
    await goOffline(true)
    await browser.evaluate(
      `document.querySelector('.ab-search input').focus(); ${retry}.click(); true`,
    )
    await goOffline(false)
    // The held refresh runs (the button goes) and is turned down (it comes back).
    assert.ok(
      await browser.waitFor(`${retry} && !${note}.startsWith('Offline')`),
      'Try again did not come back again',
    )
    const elsewhere = await browser.evaluate<string>(`document.activeElement.tagName`)
    // Refresh the titles for real, so the checks after this one start from a quiet page.
    await browser.rewriteAniList(null)
    await browser.evaluate(`${retry}.click(); true`)
    await browser.waitFor(`!${retry} && ${note} === ''`)
    assert.deepEqual(offline, {
      focus: 'ab-btn ab-retry',
      note: 'Offline: waiting for a connection.',
    })
    assert.ok(moved, 'focus fell off the button as it went')
    assert.equal(elsewhere, 'INPUT', 'the button took focus from the search box as it went')
  })

  test('a mouse press on Try again leaves the page where it is', async () => {
    await failSearches()
    await browser.search('bad request')
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results .ab-retry')`), 'no button')
    // The button just under the header, with its section's heading hidden behind the header.
    const at = await browser.evaluate<{ x: number; y: number }>(`(() => {
      const button = document.querySelector('.ab-results .ab-retry')
      scrollBy(0, button.getBoundingClientRect().top - document.querySelector('.ab-top').getBoundingClientRect().bottom - 12)
      const r = button.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    const before = await browser.evaluate<number>('scrollY')
    const click = { ...at, button: 'left', clickCount: 1 }
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...click })
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...click })
    await sleep(500)
    const after = await browser.evaluate<number>('scrollY')
    await browser.rewriteAniList(null)
    await browser.search('')
    assert.ok(before > 0, 'the page did not scroll down to the button')
    assert.equal(after, before, 'pressing Try again scrolled the page')
  })

  test('screen readers hear each search’s outcome from one status line that is always there', async () => {
    const region = `document.querySelector('main > [role="status"]')`
    // The previous check clears its search; the line empties once that settles (300 ms).
    assert.ok(
      await browser.waitFor(`${region}?.textContent === ''`, 5_000),
      'no empty announcement line at rest',
    )
    await browser.search('frieren')
    assert.ok(
      await browser.waitFor(`/^\\d+ titles? found for “frieren”$/.test(${region}?.textContent)`),
      'results not announced',
    )
    await browser.search('zzqqxx')
    assert.ok(
      await browser.waitFor(`${region}?.textContent === 'No titles found for “zzqqxx”'`),
      'no-match not announced',
    )
    await browser.search('zzqqxxy')
    assert.ok(
      await browser.waitFor(`${region}?.textContent === 'No titles found for “zzqqxxy”'`),
      'a second no-match read as no change',
    )
    const notes = await browser.evaluate<number>(
      `document.querySelectorAll('.ab-results [role="status"]').length`,
    )
    assert.equal(notes, 0, 'the results’ visible note is a second live region')
    await browser.search('')
    assert.ok(
      await browser.waitFor(`${region}?.textContent === ''`, 5_000),
      'the announcement outlived the search',
    )
  })

  test('a very long search never makes the page scroll sideways', async () => {
    await browser.search(
      'a very long search that keeps going and going past the width of the bubble and the screen '.repeat(
        2,
      ),
    )
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results')`, 5_000))
    await sleep(800)
    const wide = await browser.evaluate<number>('document.documentElement.scrollWidth - innerWidth')
    assert.ok(wide <= 0, `the page is ${wide}px wider than the screen`)
    await browser.search('')
  })

  test('from 900px up, a long search fills only the room beside the links, so the header stays one row', async () => {
    // From 900px the logo, the links and the search share one row of the sticky header, and a
    // long query's bubble fills the room the links leave. It used to drop onto a second row, so
    // on windows up to about 1300px wide the header grew from 78 to 134px and hid the headings
    // its links jump to. The check above searched this query, so this one needs no recording of
    // its own.
    const long =
      'a very long search that keeps going and going past the width of the bubble and the screen '.repeat(
        2,
      )
    const resize = (width: number) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    // The header's height and content edges, the room its links leave, the top of the links,
    // and the bubble's box, once the bubble has taken its text's measured width (a frame late)
    // and eased there.
    const measure = async () => {
      await browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
      await browser.animationsDone()
      return browser.evaluate<{
        height: number
        left: number
        right: number
        room: number
        linksTop: number
        bubble: { top: number; right: number; width: number }
      }>(`(() => {
        const top = document.querySelector('.ab-top'), box = top.getBoundingClientRect(), style = getComputedStyle(top)
        const links = document.querySelector('.ab-nav').getBoundingClientRect()
        const bubble = document.querySelector('.ab-bubble-field').getBoundingClientRect()
        const right = box.right - parseFloat(style.paddingRight)
        return {
          height: box.height,
          left: box.left + parseFloat(style.paddingLeft),
          right,
          room: right - links.right - parseFloat(style.columnGap),
          linksTop: links.top,
          bubble: { top: bubble.top, right: bubble.right, width: bubble.width },
        }
      })()`)
    }
    const rest = Math.round((await measure()).height)
    await browser.search(long)
    assert.ok(await browser.waitFor(resultsFor(long.trim())), 'the long search showed no results')
    const problems: string[] = []
    for (const width of [900, 1024, 1180, 1280]) {
      await resize(width)
      const held = await measure()
      const below = Math.round(held.bubble.top - held.linksTop)
      if (Math.abs(held.height - rest) > 1)
        problems.push(`${width}px: the header is ${Math.round(held.height)}px tall, not ${rest}px`)
      if (Math.abs(below) >= 30)
        problems.push(`${width}px: the bubble sits ${below}px below the links`)
      if (Math.abs(held.bubble.width - held.room) > 2)
        problems.push(
          `${width}px: the bubble is ${Math.round(held.bubble.width)}px wide, not the ${Math.round(held.room)}px the links leave`,
        )
    }
    // Below 900px the header stacks, and the bubble fills a row of its own.
    await resize(834)
    const stacked = await measure()
    const row = stacked.right - stacked.left
    if (Math.abs(stacked.bubble.width - row) > 2)
      problems.push(
        `834px: the bubble is ${Math.round(stacked.bubble.width)}px wide, not the row’s ${Math.round(row)}px`,
      )
    // Empty and at rest, it still sits at the header's right end.
    await resize(1024)
    await browser.search('')
    await browser.evaluate('document.activeElement.blur(); true')
    const resting = await measure()
    const short = Math.round(resting.right - resting.bubble.right)
    if (Math.abs(short) > 1)
      problems.push(`1024px, at rest: the bubble ends ${short}px short of the header’s right edge`)
    // Back to this describe's screen before anything is asserted, so the checks after this one
    // see the screen they expect.
    await resize(1440)
    assert.deepEqual(problems, [], 'a long search wraps the header, or the bubble leaves its place')
  })

  test('with WCAG text spacing, the search box never cuts its placeholder to fit the header, and takes a second row only when it must', async () => {
    // "Search titles" is the only label the search box shows. With WCAG 1.4.12's test spacing,
    // the links take more of the header, and from 900 to about 965px the bubble shrank into the
    // room they left, cutting it to "Search t". It must stay wide enough to show it, even if the
    // search then needs a second row, which WCAG allows. Chrome draws the placeholder in a box
    // of its own inside the input, beside the room it keeps for its clear button. That box is
    // out of the page's reach (in a user-agent shadow root) but not of CDP's, so this reads it:
    // the text is cut when it is wider than the box. The second row must be needed, though. The
    // search used to take it up to 978px, when from about 966px the room beside the links
    // already held the bubble with its whole placeholder.
    await browser.search('') // the placeholder shows only while the box is empty
    await browser.evaluate(`(() => {
      const style = document.head.appendChild(document.createElement('style'))
      style.id = 'text-spacing'
      style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
      return true
    })()`)
    const resize = (width: number) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    // A node as CDP's DOM.describeNode gives it, its attributes in one list of names and values.
    // Chrome marks its placeholder box pseudo="-webkit-input-placeholder", for ::placeholder.
    type Described = {
      backendNodeId: number
      attributes?: string[]
      children?: Described[]
      shadowRoots?: Described[]
    }
    const placeholderIn = (node: Described): Described | undefined =>
      node.attributes?.includes('-webkit-input-placeholder')
        ? node
        : [...(node.shadowRoots ?? []), ...(node.children ?? [])].map(placeholderIn).find(Boolean)
    // Once the bubble has taken its text's measured width (a frame late) and eased there: the
    // widths of the placeholder's box and of its text, and how far the bubble runs past the
    // header's right edge, where its room ends. Then how far below the links the bubble sits,
    // the room beside them, and the width the bubble needs there to show its whole placeholder:
    // its own width around the placeholder's box, and the text's. A range gives the text's
    // width; scrollWidth gives the box's while the box is the wider.
    const measure = async () => {
      await browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
      await browser.animationsDone()
      const input = await browser.send('Runtime.evaluate', {
        expression: `document.querySelector('.ab-search input')`,
      })
      const { node } = await browser.send('DOM.describeNode', {
        objectId: input.result.objectId,
        depth: -1,
        pierce: true,
      })
      const placeholder = placeholderIn(node)
      assert.ok(placeholder, 'Chrome’s placeholder box was not found inside the search input')
      const { object } = await browser.send('DOM.resolveNode', {
        backendNodeId: placeholder.backendNodeId,
      })
      const { result } = await browser.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function () {
          const top = document.querySelector('.ab-top'), style = getComputedStyle(top)
          const edge = top.getBoundingClientRect().right - parseFloat(style.paddingRight)
          const links = document.querySelector('.ab-nav').getBoundingClientRect()
          const bubble = document.querySelector('.ab-bubble-field').getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(this)
          return {
            box: this.clientWidth,
            text: this.scrollWidth,
            past: Math.round(bubble.right - edge),
            below: Math.round(bubble.top - links.top),
            room: edge - links.right - parseFloat(style.columnGap),
            need: bubble.width - this.getBoundingClientRect().width + range.getBoundingClientRect().width,
          }
        }`,
        returnByValue: true,
      })
      return result.value as {
        box: number
        text: number
        past: number
        below: number
        room: number
        need: number
      }
    }
    const problems: string[] = []
    try {
      for (const [state, focus] of [
        ['at rest', 'blur'],
        ['focused', 'focus'],
      ] as const) {
        await browser.evaluate(`document.querySelector('.ab-search input').${focus}(); true`)
        // At 900px, and at 960, where the room beside the links is only a little too narrow,
        // and at 970 and 978, where it is a little wider than the bubble needs.
        for (const width of [900, 960, 970, 978]) {
          await resize(width)
          const { box, text, past, below, room, need } = await measure()
          if (!text) problems.push(`${width}px, ${state}: no placeholder shows`)
          else if (text > box)
            problems.push(
              `${width}px, ${state}: the placeholder is cut to ${box}px of its ${text}px`,
            )
          if (past > 1)
            problems.push(
              `${width}px, ${state}: the bubble runs ${past}px past the header’s right edge`,
            )
          // A pixel's leeway: the placeholder's width reaches CSS rounded to a whole pixel.
          if (below >= 30 && room - need >= 1)
            problems.push(
              `${width}px, ${state}: the search drops to a second row, though the ${Math.round(room)}px beside the links hold the ${Math.round(need)}px it needs to show its whole placeholder`,
            )
        }
      }
    } finally {
      // Back to the normal view, empty and at rest, on this describe's screen before anything is
      // asserted, even if measuring failed, so the checks after this one see the page they expect.
      await browser.evaluate(
        `document.getElementById('text-spacing').remove(); document.querySelector('.ab-search input').blur(); true`,
      )
      await resize(1440)
    }
    assert.deepEqual(
      problems,
      [],
      'the search box’s placeholder, its only visible label, is cut or leaves the header, or the search takes a second row it doesn’t need',
    )
  })

  test('the header’s links land their targets below it, even when WCAG text spacing wraps it onto two rows', async () => {
    // From 900px the header stays at the top of the screen, and what its links jump to stops
    // 18px under it: 96px from the top, below its one 78px row. With WCAG 1.4.12's test
    // spacing, the search takes a second row from 900 to about 965px (see the check above), and
    // the header grows to 135 to 138px. A fixed 96px then left the top 46 to 49px of the
    // focused Trending heading, focus ring included, under the header, and 38 to 42px of the
    // Pull section. Without the spacing every target must still land at 96px, as it always
    // has, and below 900px too, where the header scrolls away with the page.
    // A resized window draws a frame before anyone can press a key, and only then does the
    // header's new height reach the page (SiteHeader's ResizeObserver sets --top-h). So each
    // resize waits two frames. Without them, on a fast machine, Enter came first at 899px: the
    // page jumped by the 78px row's height, and the heading then moved up to 40px.
    const resize = async (width: number) => {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
    }
    const links = [
      ['#ab-trending', 'the Trending heading'],
      ['#pull', 'the Pull section'],
    ] as const
    // Presses Enter on a header link from the top of the page, as a keyboard user would. Once
    // the page has jumped: the top of the link's target, and how much of it is under the header,
    // with its focus ring (4px, 3px out) when it took focus, as the Trending heading does.
    const jump = async (href: string) => {
      await browser.evaluate(`(() => {
        history.replaceState(null, '', location.pathname)
        scrollTo(0, 0)
        document.querySelector('.ab-nav a[href="${href}"]').focus()
        return true
      })()`)
      await browser.press('Enter')
      assert.ok(
        await browser.waitFor(`location.hash === '${href}'`, 5_000),
        `Enter on the header’s ${href} link went nowhere`,
      )
      await browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
      return browser.evaluate<{
        top: number
        hidden: number
        ring: boolean
        below: number
      }>(`(() => {
        const target = document.querySelector('${href}'), top = target.getBoundingClientRect().top
        const ring = document.activeElement === target
        const header = document.querySelector('.ab-top').getBoundingClientRect().bottom
        return { top, ring, hidden: Math.round(header - (ring ? top - 7 : top)), below: Math.round(top - header) }
      })()`)
    }
    const problems: string[] = []
    try {
      // Without the spacing: on one row, at this describe's width and at 900px, and at 899px,
      // where the header scrolls away.
      for (const width of [1440, 900, 899]) {
        await resize(width)
        await browser.animationsDone()
        for (const [href, name] of links) {
          const { top, hidden, ring } = await jump(href)
          if (Math.abs(top - 96) > 1)
            problems.push(`${width}px: ${name} lands at ${Math.round(top)}px, not 96px`)
          // 96px is right only while the header is one row or scrolls away: at 899px a header
          // that stuck to the top, two rows tall (134px), would hide the target at 96px.
          else if (hidden > 0)
            problems.push(
              `${width}px: ${hidden}px of ${name}${ring ? ' and its focus ring' : ''} is under the header`,
            )
        }
      }
      await browser.evaluate(`(() => {
        const style = document.head.appendChild(document.createElement('style'))
        style.id = 'text-spacing'
        style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
        return true
      })()`)
      // With the spacing, on two rows.
      for (const width of [900, 960]) {
        await resize(width)
        await browser.animationsDone()
        for (const [href, name] of links) {
          const { hidden, ring, below } = await jump(href)
          if (hidden > 0)
            problems.push(
              `${width}px with text spacing: ${hidden}px of ${name}${ring ? ' and its focus ring' : ''} is under the header`,
            )
          // Clear of the header is not enough: the same 18px gap as on one row, or an 8px gap
          // (which still clears the focus ring, by 1px) would pass.
          else if (Math.abs(below - 18) > 1)
            problems.push(
              `${width}px with text spacing: ${name} lands ${below}px below the header, not 18px`,
            )
        }
      }
    } finally {
      // Back to the normal view, at the top and on this describe's screen, before anything is
      // asserted, even if a jump failed, so the checks after this one see the page they expect.
      await browser.evaluate(`(() => {
        document.getElementById('text-spacing')?.remove()
        history.replaceState(null, '', location.pathname)
        document.activeElement.blur()
        scrollTo(0, 0)
        return true
      })()`)
      await resize(1440)
    }
    assert.deepEqual(
      problems,
      [],
      'a header link leaves its target under the header, or lands it somewhere new',
    )
  })

  test('with WCAG text spacing, link targets keep 18px under the header at every width from 900px', async () => {
    // The check above jumps with the spacing at 900 and 960px only, but the header keeps its
    // second row up to about 965px, and above that it is a taller single row (about 80px). A
    // margin that followed the header's height only up to 960px hid 48px of the focused Trending
    // heading at 963px. Every 5px from 900 to 1000px, and at 1100 and 1440px, each target's scroll
    // margin must be the header's measured height and 18px. No keys: the margin is what the
    // browser scrolls by when a link is followed.
    const frames = () =>
      browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
    const resize = (width: number) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    const widths = [...Array.from({ length: 21 }, (_, i) => 900 + 5 * i), 1100, 1440]
    const off: string[] = []
    await browser.evaluate(`(() => {
      const style = document.head.appendChild(document.createElement('style'))
      style.id = 'text-spacing'
      style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
      return true
    })()`)
    try {
      for (const width of widths) {
        await resize(width)
        await frames()
        const found = await browser.evaluate<string[]>(`(() => {
          const header = document.querySelector('.ab-top').offsetHeight
          return ['#ab-trending', '#pull', '#decades'].flatMap((target) => {
            const margin = parseFloat(getComputedStyle(document.querySelector(target)).scrollMarginTop)
            return Math.abs(margin - (header + 18)) > 1 ? [target + ': ' + margin + 'px under a ' + header + 'px header'] : []
          })
        })()`)
        for (const line of found) off.push(`${width}px: ${line}`)
      }
    } finally {
      await browser.evaluate(`document.getElementById('text-spacing')?.remove(); true`)
      await resize(1440)
      await frames()
    }
    assert.deepEqual(
      off,
      [],
      'link targets whose scroll margin is not the header’s height and 18px',
    )
  })

  test('after a resize across 900px made far down the page, the intro still ends at the fold', async () => {
    // The intro fills the first screen under the header, by the header's height (--top-h), and
    // the header changes rows at 900px: one 78px row from there up, 134px below, where it
    // scrolls away with the page. A resize made with the header scrolled far off screen must
    // still give the intro the header's new height, by the time the window has drawn two frames.
    // Publishing the header's bottom edge (far negative while scrolled away) instead of its
    // height left trending at 3024px; watching only the links, which keep their size, left it
    // 56px off; and publishing 100ms late went unseen by every other check.
    const frames = () =>
      browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
    const resize = (width: number) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    const off: string[] = []
    try {
      for (const width of [899, 1440]) {
        await browser.evaluate(`document.getElementById('pull').scrollIntoView(); true`)
        await frames()
        await resize(width)
        await frames()
        // Back at the top, measured at once: scrolling alone changes no size, so this is the
        // height the header had published by the second frame.
        const top = await browser.evaluate<number>(
          `scrollTo(0, 0), document.querySelector('.ab-page').getBoundingClientRect().top`,
        )
        if (Math.abs(top - 900) > 1)
          off.push(`${width}px: trending starts at ${Math.round(top)}px, not 900px`)
      }
    } finally {
      await resize(1440)
      await browser.evaluate('scrollTo(0, 0); true')
    }
    assert.deepEqual(off, [], 'after a resize, the intro no longer ends at the fold')
  })

  test('at every width from 540 to 1440px, the intro ends at the fold', async () => {
    // The intro fills the first screen under the header at any width, whatever height the
    // header takes there, not just at 1440px: an intro sized by a fixed 134px from 900 to 1024px,
    // where the header is one 78px row, ended 56px above the fold. Each side of the header's
    // changes at 900 and about 820px is measured, at the top of the page.
    const frames = () =>
      browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
    const resize = (width: number) =>
      browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      })
    const off: string[] = []
    try {
      for (const width of [1440, 1024, 1000, 960, 900, 899, 860, 821, 820, 700, 540]) {
        await resize(width)
        await frames()
        const top = await browser.evaluate<number>(
          `scrollTo(0, 0), document.querySelector('.ab-page').getBoundingClientRect().top`,
        )
        if (Math.abs(top - 900) > 1)
          off.push(`${width}px: trending starts at ${Math.round(top)}px, not 900px`)
      }
    } finally {
      await resize(1440)
      await frames()
    }
    assert.deepEqual(off, [], 'widths where the intro does not end at the fold')
  })

  test('every label on the pull machine reads at 4.5:1 or better', async () => {
    // WCAG contrast of every piece of text on the machine, text a ::before or ::after adds
    // included, so a label added later is measured too. Each is measured as the screen shows
    // it: from the text out to the page, every box lays its background color under what it
    // holds, alone and under each color of its pattern in turn (the screentone dots darken the
    // body's pink, whether the box's background-image draws them or its ::before or ::after
    // does), and its opacity fades all it holds over what lies behind. A see-through text color
    // is laid over the same way, and the worst case counts. Text in a box 1px or smaller is for
    // screen readers only. Every label must reach 4.5:1, even the lever's large one (WCAG asks
    // 3:1). The machine is measured at rest, so colors only hover or a press brings are not,
    // and neither is the text beside it (the hint bubble, the pulled title).
    const ratios = await browser.evaluate<{ text: string; ratio: number }[]>(`(() => {
      // Chrome gives colors written in hex, by name, or with rgb() or hsl() as rgb() or rgba().
      // Others, such as the oklch() of Tailwind's palette, would be misread: they stop the check.
      const rgba = (color) => {
        if (!/^rgba?\\(/.test(color)) throw new Error('cannot measure the color ' + color)
        const [r, g, b, a = 1] = color.match(/[\\d.]+/g).map(Number)
        return [r, g, b, a]
      }
      // One color laid over another, each as [r, g, b, alpha].
      const over = ([r, g, b, a], [R, G, B, A]) => {
        const alpha = a + A * (1 - a)
        const mix = (x, X) => (alpha ? (x * a + X * A * (1 - a)) / alpha : 0)
        return [mix(r, R), mix(g, G), mix(b, B), alpha]
      }
      const channel = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
      const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05) }
      // A ::before or ::after is drawn unless its content is none: content '' draws one too.
      const drawn = (style) => !/^(none|normal)$/.test(style.content) && style.display !== 'none'
      // Lays each pair of colors, [a letter, beside it], over one box's background: its color
      // alone, and that color under each color of the pattern drawn on it (by the box, or by its
      // ::before or ::after), each a case of its own. Then the box's opacity fades every case.
      // Nothing shows behind a solid pair, so the box's colors are read only when they can show.
      const under = (pairs, style, painters) => {
        if (pairs.some((pair) => pair.some((color) => color[3] < 1))) {
          const fill = rgba(style.backgroundColor)
          const pattern = painters.flatMap(
            (painter) => painter.backgroundImage.match(/(?:rgba?|lab|lch|oklab|oklch|color)\\([^)]*\\)/g) ?? [],
          )
          const behind = [fill, ...pattern.map((color) => over(rgba(color), fill))]
          pairs = pairs.flatMap((pair) => behind.map((back) => pair.map((color) => over(color, back))))
        }
        return pairs.map((pair) => pair.map(([r, g, b, a]) => [r, g, b, a * style.opacity]))
      }
      // The worst contrast of the text in el, or of the text its ::before or ::after adds.
      const worst = (el, pseudo) => {
        const own = getComputedStyle(el, pseudo)
        // A letter in the text's color, with nothing yet beside it.
        let pairs = [[rgba(own.color), [0, 0, 0, 0]]]
        // Text a ::before or ::after adds sits on that box first.
        if (pseudo) pairs = under(pairs, own, [own])
        for (let e = el; e; e = e.parentElement) {
          const style = getComputedStyle(e)
          const pseudos = ['::before', '::after'].map((p) => getComputedStyle(e, p)).filter(drawn)
          pairs = under(pairs, style, [style, ...pseudos])
        }
        // Where nothing is drawn, the page is white.
        const shown = pairs.map((pair) => pair.map((color) => over(color, [255, 255, 255, 1])))
        return Math.min(...shown.map(([letter, beside]) => ratio(letter, beside)))
      }
      const labels = [], machine = document.querySelector('.ab-machine')
      const measure = (text, el, pseudo) => {
        const box = el.getBoundingClientRect()
        if (!text || box.width <= 1 || box.height <= 1) return
        labels.push({ text, ratio: Math.round(worst(el, pseudo) * 100) / 100 })
      }
      const walker = document.createTreeWalker(machine, NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode()); ) measure(node.textContent.trim(), node.parentElement)
      // The text a ::before or ::after adds: the strings in its content, which Chrome quotes.
      for (const el of [machine, ...machine.querySelectorAll('*')])
        for (const pseudo of ['::before', '::after']) {
          const style = getComputedStyle(el, pseudo)
          const text = (style.content.match(/"[^"]*"/g) ?? []).map((s) => s.slice(1, -1)).join('').trim()
          if (drawn(style)) measure(text && text + ' (' + pseudo + ')', el, pseudo)
        }
      return labels
    })()`)
    assert.ok(ratios.length >= 8, `found only ${ratios.length} labels`)
    const faint = ratios.filter((label) => label.ratio < 4.5)
    assert.deepEqual(
      faint,
      [],
      `too faint: ${faint.map((l) => `${l.text} ${l.ratio}:1`).join(', ')}`,
    )
  })

  test('the vibe pill is centered on its text and clear of the chips’ focus rings', async () => {
    const pill = await browser.evaluate<{ left: number; right: number; ringGap: number }>(`(() => {
      const legend = document.querySelector('.ab-moods legend'), box = legend.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(legend)
      const text = range.getBoundingClientRect()
      // Chrome adds letter spacing after the last letter too, where it shows as space.
      const trailing = parseFloat(getComputedStyle(legend).letterSpacing)
      // A checked chip lifts 2px, and a focused one's ring reaches 7px further (4px, 3px out).
      const ringTops = [...document.querySelectorAll('.ab-moods .ab-chip span')]
        .map((chip) => ({ r: chip.getBoundingClientRect(), lifted: chip.previousElementSibling.checked }))
        .filter(({ r }) => r.left - 7 < box.right && r.right + 7 > box.left)
        .map(({ r, lifted }) => r.top - (lifted ? 0 : 2) - 7)
      return { left: text.left - box.left, right: box.right - (text.right - trailing), ringGap: Math.min(...ringTops) - box.bottom }
    })()`)
    assert.ok(
      Math.abs(pill.left - pill.right) <= 0.5,
      `the text sits ${(pill.right - pill.left).toFixed(1)}px left of center`,
    )
    assert.ok(pill.ringGap >= 2, `a focused chip's ring comes within ${pill.ringGap}px of the pill`)
  })

  test('with motion allowed, hovering a panel eases its cover into a zoom and its caption up', async () => {
    await browser.animationsDone() // each cover settles in from 1.3 times its size
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    const panel = `document.querySelectorAll('.ab-grid .ab-link')[1]`
    const cover = `getComputedStyle(${panel}.querySelector('.ab-img img')).transform`
    // Notes the cover and the caption as a transform transition starts on each. While their
    // finished entrances still held the transform, the zoom and the lift jumped there at once.
    await browser.evaluate(`(() => {
      window.__eased = new Set()
      for (const el of [${panel}.querySelector('.ab-img img'), ${panel}.querySelector('.ab-caption')])
        el.addEventListener('transitionrun', (event) => {
          if (event.target === el && event.propertyName === 'transform') window.__eased.add(el.className || el.tagName)
        })
      return true
    })()`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = ${panel}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await browser.waitFor(`${cover} === 'matrix(1.1, 0, 0, 1.1, 0, 0)'`, 3_000) // the zoom takes 0.6s
    const zoom = await browser.evaluate<string>(cover)
    const eased = await browser.evaluate<string[]>(`[...window.__eased].sort()`)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    assert.equal(zoom, 'matrix(1.1, 0, 0, 1.1, 0, 0)', 'the hovered cover did not zoom')
    assert.deepEqual(
      eased,
      ['IMG', 'ab-caption'],
      'the zoom or the caption lift jumped instead of easing',
    )
  })

  test('with motion allowed, the splash cover drifts only as the page scrolls it away', async () => {
    // The splash cover grows and slides down as its panel leaves the top of the screen. The
    // drift runs on a view() timeline, which follows the nearest scroll container: while the
    // panel links had overflow: hidden, that was the splash's own link, which never scrolls, so
    // the cover never moved.
    const matrix = `new DOMMatrix(${splashCover})`
    await scrollSplashOut(-0.05) // its top just below the top of the screen, about to leave
    const still = await browser.waitFor(`${matrix}.isIdentity`, 2_000)
    const inView = await browser.evaluate<string>(splashCover)
    await scrollSplashOut(0.5) // halfway out, it has grown about 6% and slid about 40px down
    const drifting = await browser.waitFor(`${matrix}.a > 1.03 && ${matrix}.f > 10`, 2_000)
    const halfOut = await browser.evaluate<string>(splashCover)
    await browser.evaluate('scrollTo(0, 0); true')
    assert.ok(still, `the splash cover moved before its panel began to leave the screen: ${inView}`)
    assert.ok(drifting, `the splash cover stayed put with half its panel scrolled away: ${halfOut}`)
  })

  test('with motion allowed, a title card wipes in over the dimmed page, without the fade, and closes by playing its opening backwards, twice as fast', async () => {
    // The card's base rules are what reduced motion gets (see that group): it fades in, over the
    // page as it is, and fades out as it closes. The motion gate swaps the fade for the wipe, which
    // grows from the panel over the page dimmed behind it. A gate missing either rule would fade
    // the wipe in as well, or grow it over a page that stays bright. Closing replays the opening
    // backwards at twice its speed: each part's keyframes in reverse, in half the time, so the
    // part that arrived last leaves first and the wipe shrinks back into the panel last of all. T
    // is when the opening ended; a part that started arriving at s leaves by (T - s) / 2, and the
    // card closes as the wipe ends, at T / 2. It is opened with Enter, as a visitor might: the
    // browser lets a page hold its dialog open on Esc only once the visitor has done something
    // on the page, so Esc would close a card a script opened at once whatever the page did.
    try {
      await browser.evaluate(`(() => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.focus()
        return true
      })()`)
      await browser.press('Enter')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5_000),
        'the title card did not open',
      )
      const look = await browser.evaluate<{
        card: string
        wipe: string
        backdrop: string
      }>(`(() => {
        const card = document.querySelector('dialog.ab-card')
        return {
          card: getComputedStyle(card).animationName,
          wipe: getComputedStyle(card.querySelector('.ab-wipe')).animationName,
          backdrop: getComputedStyle(card, '::backdrop').backgroundColor,
        }
      })()`)
      await cardInFull()
      // Each animation in the card by the part it plays on (a title word by its place), its
      // keyframes' name, and its timing in ms. Only the card's: the intro behind it has entrances
      // of the same names.
      type Play = { part: string; name: string; delay: number; duration: number; direction: string }
      const plays = (names: string) =>
        browser.evaluate<
          Play[]
        >(`document.getAnimations().filter((a) => a instanceof CSSAnimation && a.effect.target.closest('dialog.ab-card') && (${names})(a.animationName)).map((a) => {
          const { target, pseudoElement } = a.effect
          const word = target.style.getPropertyValue('--w')
          const { delay, duration, direction } = a.effect.getTiming()
          return { part: [target.localName, ...target.classList].join('.') + (pseudoElement ?? '') + (word ? ' word ' + word : ''), name: a.animationName, delay, duration, direction }
        })`)
      const opening = await plays(
        `(name) => ['ab-wipe', 'ab-sheet', 'ab-art', 'ab-fall', 'ab-slam', 'ab-rise'].includes(name)`,
      )
      await browser.evaluate(`(() => {
        const card = document.querySelector('dialog.ab-card')
        addEventListener('keydown', () => { window.__escAt ??= performance.now() }, { capture: true, once: true })
        card.addEventListener('close', () => { window.__closedAt = performance.now() }, { once: true })
        return true
      })()`)
      await browser.press('Escape')
      const closing = await plays(`(name) => name.endsWith('-back') || name === 'ab-undim'`)
      assert.ok(
        await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000),
        'the title card did not close',
      )
      const { took, focus } = await browser.evaluate<{ took: number; focus: string }>(
        `({ took: window.__closedAt - window.__escAt, focus: ${focusPlace} })`,
      )
      const T = Math.max(...opening.map((a) => a.delay + a.duration))
      const near = (a: number, b: number) => Math.abs(a - b) <= 1
      const off: string[] = []
      for (const open of opening) {
        const back = closing.find((a) => a.part === open.part)
        if (!back) off.push(`${open.part}: no closing animation`)
        else if (
          back.name !== `${open.name}-back` ||
          back.direction !== 'reverse' ||
          !near(back.duration, open.duration / 2) ||
          !near(back.delay + back.duration, (T - open.delay) / 2)
        )
          off.push(
            `${open.part}: ${back.name} ${back.direction}, ${back.delay} + ${back.duration} ms, for ${open.name} at ${open.delay} + ${open.duration} ms`,
          )
      }
      const undim = closing.find((a) => a.name === 'ab-undim')
      if (!undim || !near(undim.delay + undim.duration, T / 2))
        off.push(`::backdrop: ${undim ? `${undim.delay} + ${undim.duration} ms` : 'not lifted'}`)
      // The card closes as the wipe ends, give or take a frame or two.
      if (took < T / 2 - 20 || took > T / 2 + 100)
        off.push(`closed ${Math.round(took)} ms after Esc, not at ${T / 2} ms`)
      assert.ok(opening.length >= 8, `only ${opening.length} parts animated as the card opened`)
      assert.deepEqual(
        { ...look, off, focus },
        {
          card: 'none',
          wipe: 'ab-wipe',
          backdrop: 'rgba(20, 20, 20, 0.35)',
          off: [],
          focus: 'back on its panel',
        },
        'with motion allowed, the animation on the title card itself, the one on its wipe, its backdrop’s color, how its closing replayed the opening, and where the focus went',
      )
    } finally {
      await closeCardLeft()
    }
  })

  test('with motion allowed, a second request to close a title card as it plays backwards, with Esc or its button, closes it at once, with focus back on its panel', async () => {
    // As with the fade under reduced motion (see that group): asked to close again while it plays
    // its opening backwards, the card must close at once, not wait for the wipe to shrink back. The
    // closing is held as it starts, so the second request comes mid-way however slow the machine.
    const request = {
      Esc: () => browser.press('Escape'),
      'the button': () => clickMiddle(`document.querySelector('dialog.ab-card .ab-close')`),
    }
    const seen: Record<string, object> = {}
    for (const [first, second] of [
      ['Esc', 'the button'],
      ['the button', 'Esc'],
    ] as const) {
      try {
        await browser.evaluate(`(async () => {
          window.__opener = document.querySelector('.ab-grid .ab-link')
          window.__opener.scrollIntoView({ block: 'center' })
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return true
        })()`)
        await clickMiddle('window.__opener')
        assert.ok(
          await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
          'the title card did not open',
        )
        await cardInFull()
        await browser.evaluate(watchClosing(true))
        await request[first]()
        const started = await browser.evaluate<string[] | null>('window.__closingStarted')
        await browser.evaluate(watchSecondRequest)
        await request[second]()
        const closed = await browser.evaluate<string>('window.__secondRequest')
        const gone = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
        seen[`${first}, then ${second}`] = {
          backwards: started?.some((s) => s.startsWith('div.ab-wipe: clipPath')) ?? false,
          closed,
          card: gone ? 'gone' : 'still on the page',
          focus: await browser.evaluate<string>(focusPlace),
        }
      } finally {
        await closeCardLeft()
      }
    }
    const atOnce = {
      backwards: true,
      closed: 'before the next frame',
      card: 'gone',
      focus: 'back on its panel',
    }
    assert.deepEqual(
      seen,
      { 'Esc, then the button': atOnce, 'the button, then Esc': atOnce },
      'a second request to close the title card as it played backwards, each way round: whether the first started the wipe back, how soon the dialog closed after the second, whether the card left the page, and where the focus went',
    )
  })

  test('with motion allowed, a title card that starts playing backwards still closes as the device starts asking for reduced motion, with focus back on its panel', async () => {
    // Turning reduced motion on mid-way closes the motion gate, which ends the closing animations
    // early (they are cancelled, not finished). The card must close all the same, not stay open
    // over a page out of reach.
    try {
      await browser.evaluate(`(async () => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return true
      })()`)
      await clickMiddle('window.__opener')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      await browser.evaluate(watchClosing(false))
      await browser.press('Escape')
      const started = await browser.evaluate<string[] | null>('window.__closingStarted')
      assert.ok(started?.length, 'the title card did not start to play backwards')
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      const after = await browser.evaluate<{ card: string; focus: string }>(closed400msOn)
      assert.deepEqual(after, { card: 'gone', focus: 'back on its panel' })
    } finally {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
      })
      await closeCardLeft()
    }
  })

  test('with motion allowed and every animation turned off by a stylesheet of the visitor’s own, Esc still closes a title card at once, with focus back on its panel', async () => {
    // With no reverse to play, the card must not wait for one: it closes at once, as before.
    try {
      await browser.evaluate(`(() => {
        const visitors = document.createElement('style')
        visitors.id = 'visitors-own'
        visitors.textContent = '*, *::before, *::after { animation: none !important }'
        document.head.append(visitors)
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.focus()
        return true
      })()`)
      await browser.press('Enter')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      await browser.evaluate(watchSecondRequest)
      await browser.press('Escape')
      const closed = await browser.evaluate<string>('window.__secondRequest')
      assert.deepEqual(
        { closed, focus: await browser.evaluate<string>(focusPlace) },
        { closed: 'before the next frame', focus: 'back on its panel' },
      )
    } finally {
      await browser.evaluate(`document.getElementById('visitors-own')?.remove(); true`)
      await closeCardLeft()
    }
  })

  test('with motion allowed, hovering the close button floods it brand red as its X folds into a white back arrow, with speed lines, and it stays so as the card leaves', async () => {
    // The user's choice from a mockup ("Burst"): the button floods brand red, its X folds into a
    // white arrow pointing back, and a ring of manga speed lines flashes out. As the card plays its
    // way back after a click or Esc, the button keeps that look. At rest it is today's white
    // button with an ink X. The card is opened with the mouse, so the button doesn't have the
    // keyboard's focus, which brings the same look (see the next check).
    const seen: Record<string, object> = {}
    try {
      await browser.evaluate(`(async () => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return true
      })()`)
      await clickMiddle('window.__opener')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      await hoverClose(false)
      seen.atRest = await browser.evaluate(closeButton)
      await hoverClose(true)
      seen.hovered = await browser.evaluate(closeButton)
      await hoverClose(false)
      // Leaving: the way back is held where it is, so the card stays open while the button changes.
      await browser.press('Escape')
      await browser.evaluate(
        `document.getAnimations().filter((a) => a instanceof CSSAnimation && /-back$|undim/.test(a.animationName)).forEach((a) => a.pause()); true`,
      )
      await sleep(700)
      seen.leaving = await browser.evaluate(closeButton)
    } finally {
      await closeCardLeft()
    }
    const burst = {
      fill: 'rgb(255, 45, 85)',
      edge: 'rgb(255, 45, 85)',
      icon: 'arrow pointing left',
      drawnIn: 'rgb(255, 255, 255)',
      speedLines: 'shown',
    }
    assert.deepEqual(seen, {
      atRest: {
        fill: 'rgb(255, 255, 255)',
        edge: 'rgb(20, 20, 20)',
        icon: 'X',
        drawnIn: 'rgb(20, 20, 20)',
        speedLines: 'hidden',
      },
      hovered: burst,
      leaving: burst,
    })
  })

  test('with motion allowed, a title card opened from the keyboard gives its focused close button the hover look once it has finished opening, and at once when Tab comes back to it', async () => {
    // Opened with Enter, the card puts the keyboard's focus on its close button, which takes the
    // hover look then too (see the check above), but only once the card has finished opening, so
    // that its fold plays on a card already on screen, as the user asked. Its focus ring shows at
    // once. Tab away and back, and the look comes at once.
    const seen: Record<string, object | string> = {}
    try {
      await browser.evaluate(`(() => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.focus()
        return true
      })()`)
      await browser.press('Enter')
      // The opening is held as it starts (its animations, not the button's own transitions), so
      // the card stays mid-opening however fast the machine, while a look that didn't wait would
      // have had time to arrive. Then it plays on.
      await browser.evaluate(
        `document.querySelector('dialog.ab-card').getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation).forEach((a) => a.pause()); true`,
      )
      await sleep(500)
      seen.opening = await browser.evaluate(closeButton)
      seen.focus = await browser.evaluate<string>(
        `document.activeElement.matches('dialog.ab-card .ab-close') ? 'on the close button' : 'elsewhere'`,
      )
      await browser.evaluate(
        `document.querySelector('dialog.ab-card').getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation).forEach((a) => a.play()); true`,
      )
      await cardInFull()
      await sleep(700)
      seen.opened = await browser.evaluate(closeButton)
      await browser.press('Tab')
      await sleep(700)
      seen.tabbedAway = await browser.evaluate(closeButton)
      await browser.press('Tab', true)
      await sleep(700)
      seen.tabbedBack = await browser.evaluate(closeButton)
    } finally {
      await closeCardLeft()
    }
    const rest = {
      fill: 'rgb(255, 255, 255)',
      edge: 'rgb(20, 20, 20)',
      icon: 'X',
      drawnIn: 'rgb(20, 20, 20)',
      speedLines: 'hidden',
    }
    const burst = {
      fill: 'rgb(255, 45, 85)',
      edge: 'rgb(255, 45, 85)',
      icon: 'arrow pointing left',
      drawnIn: 'rgb(255, 255, 255)',
      speedLines: 'shown',
    }
    assert.deepEqual(seen, {
      opening: rest,
      focus: 'on the close button',
      opened: burst,
      tabbedAway: rest,
      tabbedBack: burst,
    })
  })

  test('every trending panel shows a brand-hot focus ring when tabbed to', async () => {
    // A panel's ring is its link's outline: 4px of brand hot, 3px out. Panels 4 and 5 share the
    // diagonal cut, whose clip-paths cut that ring away, so tabbing to them showed nothing; their
    // 4px ink frame turns brand hot instead. getComputedStyle still reports the cut-away outline,
    // so this counts brand-hot pixels in a screenshot of each panel, within 4px of its box, inside
    // or out: at least 4,400 for a whole ring or frame here, and 0 for none. The boxes of panels 4
    // and 5 overlap along the cut, where the other panel's cover shows (or its color, brand hot
    // itself for a title without one), so pixels inside another panel's box don't count.
    await browser.animationsDone() // each panel's ink wipe covers its frame until it has gone
    const panels = `document.querySelectorAll('.ab-grid .ab-link')`
    const seen: { reached: number; focusVisible: boolean; hot: number }[] = []
    for (let k = 0; k < 9; k++) {
      // Tab from the stop before the panel: the trending heading, or the panel before it.
      const before = k ? `${panels}[${k - 1}]` : `document.getElementById('ab-trending')`
      await browser.evaluate(`${before}.focus({ preventScroll: true }); true`)
      await browser.press('Tab')
      // Centers the panel and waits two frames, so it is painted there. The clip is its box with
      // 8px to spare, in whole pixels from the top left of the page.
      const { reached, focusVisible, clip } = await browser.evaluate<{
        reached: number
        focusVisible: boolean
        clip: { x: number; y: number; width: number; height: number }
      }>(`(async () => {
        const link = ${panels}[${k}]
        link.parentElement.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const r = link.parentElement.getBoundingClientRect()
        const x = Math.floor(r.left + scrollX) - 8, y = Math.floor(r.top + scrollY) - 8
        const width = Math.ceil(r.right + scrollX) + 8 - x, height = Math.ceil(r.bottom + scrollY) + 8 - y
        return {
          reached: [...${panels}].indexOf(document.activeElement) + 1,
          focusVisible: link.matches(':focus-visible'),
          clip: { x, y, width, height },
        }
      })()`)
      const png = await browser.screenshot(clip)
      // Decoded in the page. A pixel within 60 of #ff2d55 counts as brand hot.
      const hot = await browser.evaluate<number>(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        const { data } = context.getImageData(0, 0, image.width, image.height)
        // Boxes in the screenshot's pixels.
        const box = (el) => {
          const r = el.getBoundingClientRect(), x = scrollX - ${clip.x}, y = scrollY - ${clip.y}
          return { left: r.left + x, top: r.top + y, right: r.right + x, bottom: r.bottom + y }
        }
        const li = ${panels}[${k}].parentElement, own = box(li)
        const others = [...li.parentElement.children].filter((el) => el !== li).map(box)
        const within = (b, x, y, grow) => x >= b.left - grow && x < b.right + grow && y >= b.top - grow && y < b.bottom + grow
        // Within 4px of the panel's box, inside or out, and in no other panel's box.
        const atEdge = (x, y) => within(own, x, y, 4) && !within(own, x, y, -4) && !others.some((b) => within(b, x, y, 0))
        let hot = 0
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const i = (y * image.width + x) * 4
            if (atEdge(x + 0.5, y + 0.5) && Math.hypot(data[i] - 255, data[i + 1] - 45, data[i + 2] - 85) < 60) hot++
          }
        return hot
      })()`)
      seen.push({ reached, focusVisible, hot })
    }
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    assert.deepEqual(
      seen.map((s) => s.reached),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      'Tab did not go from panel to panel in order',
    )
    assert.deepEqual(
      seen
        .filter((s) => !s.focusVisible || s.hot < 1000)
        .map(
          (s) =>
            `panel ${s.reached}: ${s.hot} brand-hot pixels${s.focusVisible ? '' : ', not :focus-visible'}`,
        ),
      [],
      'panels that show no brand-hot focus ring when tabbed to',
    )
  })

  test('tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', async () => {
    assertStripInView(await tabThroughStrip())
  })

  test('the decade panels sit where they did before the row made room for focus rings', async () => {
    // 18px under the decade chips, as before the row gained 8px of room on every side.
    const gap = await browser.evaluate<number>(
      `${decadeRow}.querySelector('.ab-strip-panel').getBoundingClientRect().top - document.querySelector('.ab-eras').getBoundingClientRect().bottom`,
    )
    assert.equal(Math.round(gap), 18)
  })

  test('with motion allowed, a newly picked decade stays at Ch.1 while its titles pop in', async () => {
    // Each title pops in, small and tilted at first. The row snaps to its list items, and Chrome
    // snaps to an item's box as transformed, so when the items themselves popped in, the row slid
    // about 32px sideways and back as the first one grew. The slide was over in about 170ms, so
    // the row is read on every frame.
    const checked = `document.querySelector('.ab-eras input:checked').value`
    const first = `${decadeRow}?.querySelector('.ab-strip-title')?.textContent`
    // From the 1980s, scrolled to their end. A load opens on the 1990s, so the 1980s an earlier
    // check picked may be gone by now (or this check may run alone): pick them if so.
    if ((await browser.evaluate<string>(checked)) !== '1980s') {
      const nineties = await browser.evaluate<string>(first)
      await browser.evaluate(
        `document.querySelector('.ab-eras input[value="1980s"]').click(); true`,
      )
      assert.ok(
        await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(nineties)}`),
        'the strip kept the 1990s titles',
      )
    }
    await browser.animationsDone()
    await browser.evaluate(
      `${decadeRow}.scrollIntoView({ block: 'center' }); ${decadeRow}.scrollTo({ left: ${decadeRow}.scrollWidth, behavior: 'instant' }); true`,
    )
    await rowSettled()
    const scrolled = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    // Back to the 1990s, which come from the cache: the row's scrollLeft on every frame that
    // shows their titles, until 2 seconds after they went in, when the last has popped in.
    type Frame = { ms: number; left: number }
    const frames = await browser.evaluate<Frame[]>(`new Promise((resolve) => {
      const before = ${first}, frames = []
      let shown = null, done = false
      const finish = () => { done = true; resolve(frames) }
      const sample = (now) => {
        if (done) return
        const title = ${first}
        if (title && title !== before) {
          shown ??= now
          frames.push({ ms: Math.round(now - shown), left: ${decadeRow}.scrollLeft })
        }
        if (shown !== null && now - shown > 2000) finish()
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      setTimeout(finish, 10000)
      document.querySelector('.ab-eras input[value="1990s"]').click()
    })`)
    assert.ok(scrolled > 0, 'the 1980s row did not scroll')
    assert.ok(frames.length > 0, 'the 1990s titles never replaced the 1980s')
    assert.deepEqual(
      frames.filter((frame) => frame.left !== 0).map((frame) => `${frame.left}px at ${frame.ms}ms`),
      [],
      'the row slid off Ch.1 while the 1990s popped in (its scrollLeft, by time since their titles went in)',
    )
  })

  test('screen readers hear each pull in one sentence, and the machine says nothing on its own', async () => {
    // A live region speaks every change to its text. The whole reveal used to be one: it spoke
    // its hint when titles arrived, and each pull read the title twice, every star ("black
    // star") and the button's label. Now one status line, there from the start, says each pull.
    const line = `document.querySelector('#pull > [role="status"]')`
    const live = `[...document.querySelectorAll('#pull [aria-live], #pull [role="status"], #pull [role="alert"]')].map((el) => el.className)`
    assert.deepEqual(
      await browser.evaluate(`({ line: ${line}?.textContent ?? null, live: ${live} })`),
      { line: '', live: ['sr-only'] },
      'before any pull, the only live region in the pull section should be its empty status line',
    )
    // What the line says, and the sentence for the capsule once it has opened: the pull's
    // number from the counter, the title and its tier.
    const heard = `(() => {
      const result = document.querySelector('.ab-result.is-open:not([data-old])')
      const count = parseInt(document.querySelector('.ab-count').textContent)
      const tier = result?.querySelector('.ab-tier').textContent.split(' ')[0]
      const shown = result && 'Pull ' + count + ': ' + result.querySelector('h3').textContent + ', ' + tier + '.'
      return { line: ${line}?.textContent ?? null, count, shown }
    })()`
    // Text with a star in it that a screen reader would read out.
    const starsRead = `(() => {
      const found = [], walker = document.createTreeWalker(document.querySelector('#pull'), NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode()); )
        if (node.textContent.includes('★') && !node.parentElement.closest('[aria-hidden="true"]')) found.push(node.parentElement.className)
      return found
    })()`
    await browser.evaluate(
      `document.querySelector('#pull').scrollIntoView(); document.querySelector('.ab-lever').focus(); true`,
    )
    const counts: number[] = []
    for (let i = 0; i < 2; i++) {
      await browser.evaluate(
        `document.querySelector('.ab-result')?.setAttribute('data-old', ''); true`,
      )
      await browser.press('Enter')
      // Silent until the capsule opens 0.9s later, so the pull is heard as it is seen.
      const pressed = await browser.evaluate<{ line: string; shown: string | null }>(heard)
      assert.ok(
        pressed.shown || pressed.line === '',
        `"${pressed.line}" was heard before the capsule opened`,
      )
      await browser.waitFor(`(({ line, shown }) => shown && line === shown)(${heard})`, 5_000)
      const opened = await browser.evaluate<{ line: string; count: number; shown: string | null }>(
        heard,
      )
      assert.ok(opened.shown, 'the capsule never opened')
      assert.equal(opened.line, opened.shown, 'the line does not say the pull on screen')
      assert.match(opened.line, /^Pull \d+: .+, (SSR|SR|R|Mystery)\.$/)
      assert.deepEqual(await browser.evaluate(starsRead), [], 'stars a screen reader would read')
      counts.push(opened.count)
    }
    assert.equal(counts[1], counts[0] + 1, 'the second pull’s number did not go up by one')
    // The result itself must not speak either, or it reads the title a second time.
    assert.deepEqual(
      await browser.evaluate(live),
      ['sr-only'],
      'live regions in the pull section once a title is out',
    )
  })

  test('the lever pulls a real title from the page', async () => {
    await pull()
    assert.ok(
      await browser.evaluate(
        `document.querySelector('.ab-result:not([data-old]) h3')?.textContent`,
      ),
      'the capsule holds no title',
    )
  })

  test('with the site set to reduce motion, a pull opens at once, and otherwise its capsule drops for 0.9 s', async () => {
    // Visitors can ask for reduced motion on the site itself, not only on their device: that sets
    // data-motion="reduce" on <html> (see lib/motion.ts). This device allows motion, so with the
    // site's setting on a pull must open at once, as it does when the device asks (see the reduced
    // motion group), and with it off the capsule must still drop first. How long each pull took to
    // open, by the page's clock:
    const ms = await browser.evaluate<{ on: number; off: number }>(`(async () => {
      const root = document.documentElement, ms = {}
      try {
        for (const setting of ['on', 'off']) {
          if (setting === 'on') root.dataset.motion = 'reduce'
          else delete root.dataset.motion
          document.querySelector('.ab-result')?.setAttribute('data-old', '')
          const start = performance.now()
          document.querySelector('.ab-lever').click()
          while (!document.querySelector('.ab-result.is-open:not([data-old])') && performance.now() - start < 3000)
            await new Promise((resolve) => setTimeout(resolve, 5))
          ms[setting] = Math.round(performance.now() - start)
        }
      } finally {
        delete root.dataset.motion
      }
      return ms
    })()`)
    assert.ok(ms.on < 450, `with the site set to reduce motion, the pull took ${ms.on} ms to open`)
    assert.ok(
      ms.off >= 850,
      `with motion allowed, the pull opened after ${ms.off} ms, before its capsule's 0.9 s drop`,
    )
  })

  test('with motion allowed, the capsule shows as it splits open', async () => {
    // The capsule is hidden unless motion is allowed (see the reduced motion group), so here both
    // halves must show as the title comes out between them.
    const { opened } = await capsuleHalves()
    assert.notEqual(opened, undefined, 'the capsule never opened')
    assert.equal(
      opened,
      2,
      `with motion allowed, the capsule showed ${opened} of its 2 halves as it opened`,
    )
  })

  test('with motion allowed, hovering the lever still tilts it', async () => {
    // The other half of pull.e2e.ts's check that the off lever stays still: a working one still
    // tilts. It only hovers, so it pulls nothing.
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('.ab-lever').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(400) // longer than the lever's 0.25s turn
    const lever = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-lever')).transform`,
    )
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
    assert.equal(
      lever,
      'matrix(0.984808, -0.173648, 0.173648, 0.984808, 0, 0)', // rotate(-10deg)
      'the hovered lever did not tilt',
    )
  })

  test('with motion allowed, a fresh load plays the intro’s entrance in full', async () => {
    // As motion comes back on, the Reduce motion switch finishes every entrance on the page at once
    // (see watchMotionBackOn() in lib/motion.ts). Its watch calls back as the page loads too, with
    // nothing changed, and finishing them then would skip the entrances that have only just
    // begun. The intro's are on the page from its first frame: its kicker, the three parts of its
    // title, its lede and its buttons rise in, and its sound effect pops. Each must show part way
    // through in some frame, read from the first one: the sampler goes in before the page's own
    // scripts run. The intro's covers come later, with the titles, and are left out.
    const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__intro = new Map()
        const look = () => {
          if (window.__introRead) return
          for (const a of document.getAnimations())
            if (a instanceof CSSAnimation && a.effect.target.closest('.ab-intro') && !a.effect.target.closest('.ab-intro-art')) {
              const { localTime, delay, activeDuration } = a.effect.getComputedTiming()
              const partWay = a.playState === 'running' && localTime > delay && localTime < delay + activeDuration
              window.__intro.set(a, window.__intro.get(a) || partWay)
            }
          requestAnimationFrame(look)
        }
        requestAnimationFrame(look)
      })()`,
    })
    try {
      await browser.load()
      assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
      await browser.animationsDone()
      const intro = await browser.evaluate<{ found: number; unseen: string[] }>(`(() => {
        window.__introRead = true
        const unseen = {}
        for (const [a, partWay] of window.__intro)
          if (!partWay) {
            const { target } = a.effect
            const owner = target.closest('[class]')
            const said = a.animationName + ' on ' + (owner === target ? '.' + target.classList[0] : target.localName + ' in .' + owner.classList[0])
            unseen[said] = (unseen[said] ?? 0) + 1
          }
        return {
          found: window.__intro.size,
          unseen: Object.entries(unseen).map(([said, count]) => (count > 1 ? said + ' ×' + count : said)).sort(),
        }
      })()`)
      assert.deepEqual(
        intro,
        { found: 7, unseen: [] },
        'on a fresh load with motion allowed, how many of the intro’s animations the page started, and those that no frame showed part way through',
      )
    } finally {
      await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    }
  })

  test('Space toggles the footer’s Reduce motion switch, with a brand-hot focus ring', async () => {
    // A native checkbox with role="switch", above AniList's credit. On, it sets data-motion="reduce"
    // on <html>, which every motion rule and script obeys, and saves the choice for later visits
    // (see lib/motion.ts); off, it takes both away. Its target is 44px tall. Its focus ring is
    // brand hot, as on the decade chips: the vibe chips' white ring, made for the pull machine's
    // pink, would vanish on paper. The ring is counted in brand-hot pixels around the chip: about
    // 1,800 for a whole one, and 0 for none. Its knob slides as it turns off, with motion allowed
    // again, but not as it turns on: the setting it turns on stops that slide too. The knob's side
    // says the state without color, on the left while off and on the right while on, so the knob
    // must stand out from its track at 3:1 or better as the screen shows it: a pale knob on the
    // white track would leave off and on told apart by their fills alone. The line that says why
    // the switch is locked is for a locked switch alone (see the reduced motion group): here no
    // such line shows, and a screen reader hears no description, as it would from a line hidden
    // from sight but still tied to the switch by aria-describedby.
    const place = await browser.evaluate<{ name: string; height: number; above: boolean } | null>(
      `(() => {
        const input = ${motionSwitch}
        if (!input) return null
        const label = input.closest('label').getBoundingClientRect()
        const credit = [...document.querySelectorAll('.ab-foot *')].find((el) => el.textContent.startsWith('Data from AniList'))
        return { name: input.closest('label').textContent.trim(), height: label.height, above: Boolean(credit) && label.bottom <= credit.getBoundingClientRect().top }
      })()`,
    )
    assert.ok(place, 'the footer has no Reduce motion switch (a checkbox with role="switch")')
    assert.deepEqual(
      { name: place.name, above: place.above },
      { name: 'Reduce motion', above: true },
      'the switch’s label, and whether it sits above AniList’s credit',
    )
    assert.ok(place.height >= 44, `the switch’s target is ${place.height}px tall`)
    await tabToSwitch()
    const steps = [await readSwitch()]
    for (let press = 0; press < 2; press++) {
      await browser.press('Space')
      await browser.animationsDone()
      steps.push(await readSwitch())
    }
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    // Each step in a few words: on or off, focused from the keyboard or not, its ring, the line
    // that says why it is locked and its description (null for none), data-motion on <html>, the
    // saved choice, whether its knob slid, and where it shows (see readSwitch).
    const said = steps.map(
      (s) =>
        `${s.checked ? 'on' : 'off'}, ${s.focused ? 'focused' : 'not focused'}, ring ${s.ring}, line ${JSON.stringify(s.why)}, description ${JSON.stringify(s.description)}, data-motion ${s.motion}, saved ${s.saved}, knob ${s.slid.includes('transform') ? 'slid' : 'still'}, ${s.knob}`,
    )
    assert.deepEqual(
      said,
      [
        'off, focused, ring brand hot, line null, description null, data-motion null, saved null, knob still, on the left at 3:1 or better',
        'on, focused, ring brand hot, line null, description null, data-motion reduce, saved reduce, knob still, on the right at 3:1 or better',
        'off, focused, ring brand hot, line null, description null, data-motion null, saved null, knob slid, on the left at 3:1 or better',
      ],
      'the switch as Tab reached it, then after Space, and after Space again',
    )
  })

  test('the intro is drawn where it stays from its first frame, whatever the header’s height', async () => {
    // As on a phone (see the phone check "the intro is drawn where it stays, from its first
    // frame"). The header is one 78px row from 900px up, two rows (134px) from about 700 to
    // 899px, and 180px at about 540 to 600px. These widths take each of those heights, and 960px
    // lies where a height guessed by breakpoint, rather than measured, went wrong. Sized by the
    // 80px fallback, the first frame at 860px was 27px off. The page stays loaded at 600px.
    const moved: string[] = []
    for (const width of [1440, 960, 860, 600])
      for (const part of await introMovesOnLoad({ width, height: 900 }))
        moved.push(`${width}px: ${part}`)
    // And once reloaded, as a visitor's browser button does.
    for (const part of await introMovesOnReload()) moved.push(`600px, reloaded: ${part}`)
    assert.deepEqual(moved, [], 'parts of the intro that moved after they were drawn')
  })

  test('the console stays free of errors and warnings', () => {
    assert.deepEqual(browser.problems, [])
  })
})

/** Pulls the lever and waits for the new result to open. Each pull renders a fresh result. */
async function pull() {
  await browser.evaluate(
    `document.querySelector('.ab-result')?.setAttribute('data-old', ''); document.querySelector('#pull').scrollIntoView(); document.querySelector('.ab-lever').click(); true`,
  )
  assert.ok(
    await browser.waitFor(
      `document.querySelector('.ab-result.is-open:not([data-old]) .ab-sfx-tier')`,
    ),
    'nothing was pulled',
  )
}

/**
 * Pulls the lever and counts the capsule halves on show, drawn and not see-through: the most at
 * any change to the new result before it opens (`pulled`), and from when it opens until two
 * frames later (`opened`). Each change is read as React makes it, before the browser draws
 * anything, so a state counts even if it lasts a frame or less. A moment never reached has no
 * count.
 */
async function capsuleHalves() {
  return browser.evaluate<{ pulled?: number; opened?: number }>(`(async () => {
    const result = () => document.querySelector('.ab-result:not([data-old])')
    const shown = {}
    const count = () => {
      const now = result()
      if (!now) return
      const moment = now.classList.contains('is-open') ? 'opened' : 'pulled'
      const halves = [...now.querySelectorAll('.ab-half')].filter((half) => half.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length
      shown[moment] = Math.max(shown[moment] ?? 0, halves)
    }
    document.querySelector('.ab-result')?.setAttribute('data-old', '')
    document.querySelector('#pull').scrollIntoView()
    const watch = new MutationObserver(count)
    watch.observe(document.querySelector('.ab-reveal'), { childList: true, attributes: true, subtree: true })
    const start = performance.now()
    document.querySelector('.ab-lever').click()
    while (!result()?.classList.contains('is-open') && performance.now() - start < 10000)
      await new Promise((resolve) => setTimeout(resolve, 5))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    count()
    watch.disconnect()
    return shown
  })()`)
}

/**
 * Pulls with motion reduced, so the title opens at once, then turns reduced motion off with
 * `turnOff` and reads what that starts, in a few words. In the first frame drawn with motion back
 * on, just before it is drawn: whether motion is back on; each CSS animation on the page's own
 * clock not yet finished, as "name on what, play state", with how many; and the capsule halves
 * shown over the open title. That frame, and not a later one: an entrance finished only once that
 * frame is drawn (in a timeout, say) shows in it at its first keyframe, yet reads as finished a
 * frame later. As the device stops asking, Chrome draws that frame before it tells the page, so
 * the reading can't wait for a change event: it looks at every frame from before the change. It
 * asks <html> and the media query whether motion is back on, which leaves the page's styles as
 * they are: asking for its animations brings them up to date, which would start the gates'
 * animations ahead of the frame's own restyle. In the first frame with motion back on, a
 * ResizeObserver made there takes the reading. Its callback runs after layout, just before the
 * frame is drawn, and after those of the page's own observers, made earlier: callbacks run in the
 * order the observers were made. So an entrance the page finishes in one of them is in time, as
 * is one finished in a frame callback. If motion is still reduced 10 s on, the reading comes
 * then, and says so. Next, whether the splash cover's drift still follows the scroll, as the
 * desktop check reads it: still just before its panel starts to leave the screen, and drifting
 * once half of it has. Then each animation a new pull runs on its result, and whether some frame
 * showed it part way through, which no frame does for one finished at once. Last, how the Reduce
 * motion switch's knob moved as motion came back on, which it has long done by then: it slid if
 * its transition took 100ms or more to end, and jumped if it ended at once.
 */
async function motionBackOn(turnOff: () => Promise<unknown>) {
  await pull()
  await browser.evaluate(`(() => {
    const chip = ${motionSwitch}.nextElementSibling
    window.__knob = {}
    for (const type of ['transitionrun', 'transitionend'])
      chip.addEventListener(type, (event) => {
        if (event.pseudoElement === '::after' && event.propertyName === 'transform') window.__knob[type] ??= performance.now()
      })
    window.__backOn = new Promise((resolve) => {
      const read = () => {
        const left = {}
        for (const a of document.getAnimations())
          if (a instanceof CSSAnimation && a.timeline === document.timeline && a.playState !== 'finished') {
            const { target, pseudoElement } = a.effect
            const owner = target.closest('[class]')
            const element = (owner === target ? '.' + target.classList[0] : target.localName + ' in .' + owner?.classList[0]) + (pseudoElement ?? '')
            const said = a.animationName + ' on ' + element + ', ' + a.playState
            left[said] = (left[said] ?? 0) + 1
          }
        const reduced = document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches
        resolve({
          motion: reduced ? 'still reduced' : 'back on',
          replayed: Object.entries(left).map(([said, count]) => (count > 1 ? said + ' ×' + count : said)).sort(),
          capsule: [...document.querySelectorAll('.ab-result.is-open:not([data-old]) .ab-half')].filter((half) => half.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length,
        })
      }
      let gaveUp = false
      const giveUp = setTimeout(() => {
        gaveUp = true
        read()
      }, 10000)
      const watch = () => {
        if (gaveUp) return
        if (document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches)
          return requestAnimationFrame(watch)
        clearTimeout(giveUp)
        const last = new ResizeObserver(() => {
          last.disconnect()
          read()
        })
        last.observe(document.documentElement)
      }
      requestAnimationFrame(watch)
    })
    return true
  })()`)
  await turnOff()
  const now = await browser.evaluate<{ motion: string; replayed: string[]; capsule: number }>(
    'window.__backOn',
  )
  const matrix = `new DOMMatrix(${splashCover})`
  await scrollSplashOut(-0.05)
  const aboutToLeave = (await browser.waitFor(`${matrix}.isIdentity`, 2_000))
    ? 'still'
    : await browser.evaluate<string>(splashCover)
  await scrollSplashOut(0.5)
  const halfOut = (await browser.waitFor(`${matrix}.a > 1.03 && ${matrix}.f > 10`, 2_000))
    ? 'drifting'
    : await browser.evaluate<string>(splashCover)
  const nextPull = await browser.evaluate<string[]>(`(async () => {
    document.querySelector('.ab-result')?.setAttribute('data-old', '')
    document.querySelector('#pull').scrollIntoView()
    const result = () => document.querySelector('.ab-result:not([data-old])')
    const its = () => document.getAnimations().filter((a) => a instanceof CSSAnimation && result()?.contains(a.effect.target))
    const seen = {}
    let watching = true
    const look = () => {
      for (const a of its()) {
        const { localTime, delay, activeDuration } = a.effect.getComputedTiming()
        if (a.playState === 'running' && localTime > delay && localTime < delay + activeDuration) seen[a.animationName] = 'played'
        else seen[a.animationName] ??= 'not seen part way'
      }
      if (watching) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    document.querySelector('.ab-lever').click()
    const start = performance.now()
    while (!(result()?.classList.contains('is-open') && its().every((a) => a.playState === 'finished')) && performance.now() - start < 6000)
      await new Promise((resolve) => setTimeout(resolve, 20))
    watching = false
    return Object.entries(seen).map(([name, how]) => name + ': ' + how).sort()
  })()`)
  const knob = await browser.evaluate<string>(`(({ transitionrun, transitionend }) =>
    transitionrun === undefined ? 'never moved' : transitionend === undefined ? 'still moving' : transitionend - transitionrun >= 100 ? 'slid' : 'jumped'
  )(window.__knob)`)
  return { ...now, splash: { aboutToLeave, halfOut }, nextPull, knob }
}

// What motionBackOn() must read: motion back on with nothing left playing and no capsule over the
// open title, the knob sliding off, the drift following the scroll, and a new pull playing each of
// its animations: the capsule's drop and split, the burst, the art, the tier's boom, the text.
const BACK_ON = {
  motion: 'back on',
  replayed: [],
  capsule: 0,
  knob: 'slid',
  splash: { aboutToLeave: 'still', halfOut: 'drifting' },
  nextPull: [
    'ab-art: played',
    'ab-burst: played',
    'ab-drop: played',
    'ab-rise: played',
    'ab-split-bottom: played',
    'ab-split-top: played',
    'ab-tier-boom: played',
  ],
}

/**
 * From now on, notes what closing the open title card starts, from the moment it starts to close:
 * an attribute on it or on anything in it changes, or it leaves the page. Each animation started
 * by then is noted before a frame is drawn, and held at its start if `hold`, in window.__closing;
 * that moment, by the page's clock, is window.__closingAt. window.__closingStarted gives each one
 * in words, as the opening's check does (where it runs, what its keyframes change, how long it
 * takes and how often it runs), or null if the card hasn't started to close 5 s on.
 */
const watchClosing = (hold: boolean) => `(() => {
  const card = document.querySelector('dialog.ab-card')
  const running = new Set(document.getAnimations())
  window.__closingStarted = new Promise((resolve) => {
    const watch = new MutationObserver(() => {
      watch.disconnect()
      window.__closingAt = performance.now()
      window.__closing = document.getAnimations().filter((a) => !running.has(a))
      resolve(window.__closing.map((a) => {
        if (${hold}) a.pause()
        const { target, pseudoElement } = a.effect
        const where = target === card && !pseudoElement ? 'the card' : [target.localName, ...target.classList].join('.') + (pseudoElement ?? '')
        const changes = a.transitionProperty ? [a.transitionProperty] : [...new Set(a.effect.getKeyframes().flatMap(Object.keys))].filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)).sort()
        const { delay, duration, iterations } = a.effect.getTiming()
        const ms = delay + duration
        return where + ': ' + changes.join(', ') + ', ' + (ms <= 150 ? 'in 150 ms or less' : 'in ' + Math.round(ms) + ' ms') + ', ' + (iterations === 1 ? 'once' : iterations === Infinity ? 'forever' : iterations + ' times')
      }))
    })
    watch.observe(card, { attributes: true, subtree: true })
    watch.observe(card.parentElement, { childList: true })
    setTimeout(() => {
      watch.disconnect()
      resolve(null)
    }, 5000)
  })
  return true
})()`

// Where the focus is, in words: back on the panel that opened the title card (window.__opener),
// or on whatever has it instead, <body> if nothing does.
const focusPlace = `document.activeElement === window.__opener ? 'back on its panel' : 'on ' + [document.activeElement.localName, ...document.activeElement.classList].join('.')`

// 400 ms after the title card started to close (window.__closingAt), by the page's own clock, and
// two frames on, so that what is read has been drawn: whether the card has left the page, and
// where the focus is.
const closed400msOn = `(async () => {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, window.__closingAt + 400 - performance.now())))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return { card: document.querySelector('dialog.ab-card') ? 'still on the page' : 'gone', focus: ${focusPlace} }
})()`

/**
 * From now on, notes how soon the open title card stops showing (its dialog closed, or the card
 * gone from the page) after the next request to close it: a click or keydown, heard first, on
 * window. window.__secondRequest gives 'before the next frame' if no frame was drawn in between,
 * else how many were and how long that took, by the page's clock, or 'still open 400 ms on'. It
 * counts frames, not ms: a slow machine stretches the time the request itself takes, but no frame
 * can come between the request and a close it makes at once.
 */
const watchSecondRequest = `(() => {
  const card = document.querySelector('dialog.ab-card')
  const showing = () => card?.open && card.isConnected
  window.__secondRequest = new Promise((resolve) => {
    if (!showing()) return resolve('closed before the request')
    let at
    let frames = 0
    const heard = () => {
      for (const type of ['click', 'keydown']) removeEventListener(type, heard, true)
      at = performance.now()
      requestAnimationFrame(function frame() {
        if (!showing()) return
        frames++
        if (performance.now() - at < 400) requestAnimationFrame(frame)
        else resolve('still open 400 ms on')
      })
    }
    for (const type of ['click', 'keydown']) addEventListener(type, heard, true)
    const watch = new MutationObserver(() => {
      if (showing()) return
      watch.disconnect()
      if (at === undefined) return resolve('closed before the request')
      const ms = Math.round(performance.now() - at)
      resolve(frames === 0 ? 'before the next frame' : 'after ' + frames + (frames === 1 ? ' frame' : ' frames') + ', ' + ms + ' ms')
    })
    watch.observe(card, { attributes: true, attributeFilter: ['open'] })
    watch.observe(card.parentElement, { childList: true })
    setTimeout(() => resolve('no request heard in 5 s'), 5000)
  })
  return true
})()`

/**
 * The open title card's close button as it looks: its fill, ring of speed lines (shown or not), and
 * its icon, by the color it is drawn in and its shape. The icon is drawn with bars; the shape reads
 * their boxes against the icon's middle: an X is two crossed bars, square-ish, on the middle; an
 * arrow pointing left is a long flat bar (its shaft) on the middle and two short ones (its head)
 * to the left of it, one above and one below.
 */
const closeButton = `(() => {
  const button = document.querySelector('dialog.ab-card .ab-close')
  const icon = button.querySelector('.ab-x')
  const style = getComputedStyle(button)
  let shape = 'no icon of bars'
  if (icon) {
    const box = icon.getBoundingClientRect(), mx = box.left + box.width / 2, my = box.top + box.height / 2
    const bars = [...icon.children].map((bar) => bar.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height, dx: r.left + r.width / 2 - mx, dy: r.top + r.height / 2 - my }))
    const shown = bars.filter((b) => b.w > 1 && b.h > 1)
    const middle = (b) => Math.abs(b.dx) < 2 && Math.abs(b.dy) < 2
    const shaft = shown.find((b) => b.w > 15 && b.h < 6 && middle(b))
    const head = shown.filter((b) => b !== shaft && b.w < 11 && b.h < 11 && b.dx < -3)
    if (shown.length === 2 && shown.every((b) => middle(b) && Math.abs(b.w - b.h) < 2 && b.w > 12)) shape = 'X'
    else if (shaft && head.length === 2 && head.some((b) => b.dy < -2) && head.some((b) => b.dy > 2)) shape = 'arrow pointing left'
    else shape = 'something else'
  }
  return {
    fill: style.backgroundColor,
    edge: style.borderTopColor,
    icon: shape,
    drawnIn: icon ? getComputedStyle(icon).color : getComputedStyle(button.querySelector('svg')).stroke,
    speedLines: getComputedStyle(button, '::before').opacity === '1' ? 'shown' : 'hidden',
  }
})()`

/** Moves the mouse onto the open title card's close button, or away to the corner. */
async function hoverClose(on: boolean) {
  const at = on
    ? await browser.evaluate<{ x: number; y: number }>(`(() => {
        const r = document.querySelector('dialog.ab-card .ab-close').getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
    : { x: 2, y: 2 }
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  // Long enough for the button's longest change, its spring, to settle.
  await sleep(700)
}

/** Waits until the open title card shows in full: its fade done, and the images on screen drawn. */
async function cardInFull() {
  await browser.animationsDone()
  await browser.evaluate(`(async () => {
    const onScreen = (img) => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
    await Promise.all([...document.images].filter(onScreen).map((img) => img.decode().catch(() => {})))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  })()`)
}

/** Clicks the middle of what `element` finds in the page, as a mouse does. It must be in view. */
async function clickMiddle(element: string) {
  const at = await browser.evaluate<{ x: number; y: number }>(`(() => {
    const r = ${element}.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  for (const type of ['mousePressed', 'mouseReleased'])
    await browser.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 })
}

/**
 * Closes at once any title card a check left open, and puts the page back as the checks after it
 * expect it: nothing focused, scrolled to the top, and the mouse in the corner.
 */
async function closeCardLeft() {
  await browser.evaluate(`(() => {
    document.querySelector('dialog.ab-card')?.close()
    document.activeElement?.blur()
    scrollTo(0, 0)
    for (const name of ['__closing', '__closingStarted', '__closingAt', '__secondRequest', '__opener', '__lastScreen']) delete window[name]
    return true
  })()`)
  await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
}

describe('tablet (834x1112, iPad Pro 11" portrait) and up', () => {
  before(async () => {
    await browser.load({ width: 834, height: 1112 })
    assert.ok(await browser.titlesShown())
  })

  test('a pulled title stacks under its poster, and nothing overflows once it has landed', async () => {
    await pull()
    await browser.animationsDone() // the rarity sticker pops in from 2.4 times its size
    const result = await browser.evaluate<{ columns: string; wide: number }>(`({
      columns: getComputedStyle(document.querySelector('.ab-result')).gridTemplateColumns,
      wide: document.documentElement.scrollWidth - innerWidth,
    })`)
    // Beside the poster, the text got a column about 56px wide (review finding F2).
    assert.equal(result.columns.split(' ').length, 1, `the result has columns ${result.columns}`)
    assert.ok(result.wide <= 0, `the page is ${result.wide}px wider than the screen`)
  })

  test('a pulled title’s long words never break mid-word, from tablet to desktop', async () => {
    await pull()
    await browser.animationsDone()
    // Long words from real titles (isekai titles are full of "Reincarnated").
    const words =
      'Bakemonogatari Assassination Entertainment Reincarnation Reincarnated Experiments Edgerunners Brotherhood Apothecary Cardcaptor'
    const broken: string[] = []
    for (const width of [834, 1001, 1024, 1060, 1100, 1170, 1180, 1280, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1112,
        deviceScaleFactor: 1,
        mobile: false,
      })
      const split = await browser.evaluate<string[]>(`(() => {
        const h3 = document.querySelector('.ab-result h3'), text = ${JSON.stringify(words)}, split = []
        h3.textContent = text
        let at = 0
        for (const word of text.split(' ')) {
          const start = text.indexOf(word, at), range = document.createRange()
          at = start + word.length
          range.setStart(h3.firstChild, start)
          range.setEnd(h3.firstChild, at)
          if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) split.push(word)
        }
        return split
      })()`)
      if (split.length) broken.push(`${width}px: ${split.join(', ')}`)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 834,
      height: 1112,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(broken, [], 'words split across lines')
  })

  test('the rarity sticker never makes the page scroll sideways as it pops in', async () => {
    const wider: string[] = []
    for (const [width, phone] of [
      [821, false],
      [390, true],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: phone ? 2 : 1,
        mobile: phone,
      })
      await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
      // Pulls, gives the sticker the widest label (SSR!!) as it appears, and measures the page
      // every frame until the pop has settled. Phones widen the page to fit what overflows.
      const wide = await browser.evaluate<number>(`new Promise((resolve) => {
        const label = new MutationObserver(() => {
          const sticker = document.querySelector('.ab-result:not([data-old]) .ab-sfx-tier')
          if (sticker && sticker.textContent !== 'SSR!!') sticker.textContent = 'SSR!!'
        })
        label.observe(document.querySelector('.ab-reveal'), { childList: true, subtree: true })
        document.querySelector('.ab-result')?.setAttribute('data-old', '')
        document.querySelector('.ab-lever').click()
        const start = performance.now()
        let widest = 0
        const frame = () => {
          widest = Math.max(widest, document.documentElement.scrollWidth, innerWidth)
          if (performance.now() - start < 2600) requestAnimationFrame(frame)
          else (label.disconnect(), resolve(widest - ${width}))
        }
        requestAnimationFrame(frame)
      })`)
      if (wide > 0) wider.push(`${width}px: ${wide}px wider`)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 834,
      height: 1112,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.deepEqual(wider, [], 'the page grew wider than the screen')
  })
})

// Visitors can ask for reduced motion on their device, or on the site itself, whose setting is
// data-motion="reduce" on <html> (see lib/motion.ts). Every motion rule and script must hear both,
// so these checks run twice: once with the device asking, and once on a device that allows
// motion, with the site's setting turned on after the page has loaded.
describe('reduced motion', () => reducedMotionChecks('device'))
describe('reduced motion, set on the site', () => reducedMotionChecks('site'))

function reducedMotionChecks(askedOn: 'device' | 'site') {
  before(async () => {
    await browser.load({ reduceMotion: askedOn === 'device' })
    if (askedOn === 'site')
      await browser.evaluate(`document.documentElement.dataset.motion = 'reduce'; true`)
    assert.ok(await browser.titlesShown())
  })

  test('a title card opened from the keyboard turns its focused close button red once it has faded in, its X white and still', async () => {
    // As with motion allowed, the focus look waits for the card to finish opening, here its fade,
    // and is only a change of color.
    const seen: Record<string, object> = {}
    try {
      await browser.evaluate(`(() => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.focus()
        return true
      })()`)
      await browser.press('Enter')
      // The opening is held as it starts (its animations, not the button's own transitions), so
      // the card stays mid-opening however fast the machine, while a look that didn't wait would
      // have had time to arrive. Then it plays on.
      await browser.evaluate(
        `document.querySelector('dialog.ab-card').getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation).forEach((a) => a.pause()); true`,
      )
      await sleep(500)
      seen.opening = await browser.evaluate(closeButton)
      await browser.evaluate(
        `document.querySelector('dialog.ab-card').getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation).forEach((a) => a.play()); true`,
      )
      await cardInFull()
      await sleep(700)
      seen.opened = await browser.evaluate(closeButton)
    } finally {
      await closeCardLeft()
    }
    assert.deepEqual(seen, {
      opening: {
        fill: 'rgb(255, 255, 255)',
        edge: 'rgb(20, 20, 20)',
        icon: 'X',
        drawnIn: 'rgb(20, 20, 20)',
        speedLines: 'hidden',
      },
      opened: {
        fill: 'rgb(255, 45, 85)',
        edge: 'rgb(255, 45, 85)',
        icon: 'X',
        drawnIn: 'rgb(255, 255, 255)',
        speedLines: 'hidden',
      },
    })
  })

  test('hovering the close button turns it brand red, its X white, and moves nothing: no fold, no speed lines', async () => {
    // Reduced motion keeps the color, which moves nothing, and drops the fold and the ring.
    const seen: Record<string, object> = {}
    try {
      await browser.evaluate(`(async () => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return true
      })()`)
      await clickMiddle('window.__opener')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      await hoverClose(true)
      seen.hovered = await browser.evaluate(closeButton)
      await hoverClose(false)
    } finally {
      await closeCardLeft()
    }
    assert.deepEqual(seen, {
      hovered: {
        fill: 'rgb(255, 45, 85)',
        edge: 'rgb(255, 45, 85)',
        icon: 'X',
        drawnIn: 'rgb(255, 255, 255)',
        speedLines: 'hidden',
      },
    })
  })

  test('opening a title card runs one fade of 150 ms or less, and no frame of it changes a quarter of the screen', async () => {
    // Spec §3J: with reduced motion, the card comes in with a 150 ms cross-fade, not its color
    // wipe. Shown at once, it switched most of the screen to the title's color in a single frame:
    // 61% of it here, and 78-80% in the research's measurements (R1). Each animation the opening
    // starts is noted as the card opens, before a frame is drawn, and held at its start: where it
    // runs, what its keyframes change, how long it takes and how often it runs. Then the opening
    // is played by hand, one 60 Hz frame at a time, each frame compared with the one before
    // (screenChange). An even fade spreads the change over its nine frames, and no frame here
    // changes more than 12% of the screen. The images on screen are drawn first, so that what
    // changes is the card's doing.
    await browser.evaluate(`(async () => {
      const onScreen = (img) => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
      await Promise.all([...document.images].filter(onScreen).map((img) => img.decode().catch(() => {})))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return true
    })()`)
    await screenChange(true)
    const started = await browser.evaluate<string[] | null>(`new Promise((resolve) => {
      const running = new Set(document.getAnimations())
      const watch = new MutationObserver(() => {
        const card = document.querySelector('dialog.ab-card')
        if (!card?.open) return
        watch.disconnect()
        window.__opening = document.getAnimations().filter((a) => !running.has(a))
        resolve(window.__opening.map((a) => {
          a.pause()
          const { target, pseudoElement } = a.effect
          const where = target === card && !pseudoElement ? 'the card' : [target.localName, ...target.classList].join('.') + (pseudoElement ?? '')
          const changes = a.transitionProperty ? [a.transitionProperty] : [...new Set(a.effect.getKeyframes().flatMap(Object.keys))].filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)).sort()
          const { delay, duration, iterations } = a.effect.getTiming()
          const ms = delay + duration
          return where + ': ' + changes.join(', ') + ', ' + (ms <= 150 ? 'in 150 ms or less' : 'in ' + Math.round(ms) + ' ms') + ', ' + (iterations === 1 ? 'once' : iterations === Infinity ? 'forever' : iterations + ' times')
        }))
      })
      watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
      setTimeout(() => resolve(null), 5000)
      document.querySelector('.ab-grid .ab-link').click()
    })`)
    assert.ok(started, 'the title card did not open')
    // The card's cover is drawn before the first frame is taken, so it can't come in between two.
    await browser.evaluate(
      `document.querySelector('dialog.ab-card img').decode().catch(() => {}).then(() => true)`,
    )
    // Frames up to the opening's end, and one past it; 300 ms at most, as longer fails anyway.
    const end = await browser.evaluate<number>(
      `Math.min(300, Math.max(0, ...window.__opening.map((a) => a.effect.getComputedTiming().endTime)))`,
    )
    const frames = [...Array(Math.ceil((end * 60) / 1000)).keys()].map((k) => (k * 1000) / 60)
    const changed: number[] = []
    for (const at of [...frames, end + 1]) {
      await browser.evaluate(`(() => {
        for (const a of window.__opening) a.currentTime = ${at}
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
      })()`)
      changed.push((await screenChange()) ?? 0)
    }
    await browser.evaluate(
      `for (const a of window.__opening) a.cancel(); delete window.__opening; delete window.__lastScreen; true`,
    )
    const most = Math.max(...changed)
    assert.deepEqual(
      { started, most: most < 25 ? 'under a quarter' : `${most}%` },
      { started: ['the card: opacity, in 150 ms or less, once'], most: 'under a quarter' },
      'the animations opening the title card started (where each ran, what its keyframes change, how long it took and how often it ran), and the most of the screen one 60 Hz frame of the opening changed',
    )
  })

  test('a title card shows in full 400 ms after it opens, by the page’s own clock, with no animation left playing or paused', async () => {
    // Here nothing is set by hand: the page plays the opening itself, on its own clock. An
    // animation that never plays, written paused or held by a rule that pauses every animation
    // while the site is set to reduce motion, keeps its first frame for good, which can hide the
    // card, and only the page's own clock shows that. So the wait is timed in the page, on the
    // clock its animations run on: 400 ms after the card opens, well past anything the opening
    // plays under reduced motion, the card must show in full, and no animation on the page may be
    // left playing or paused.
    await browser.evaluate(`document.querySelector('dialog.ab-card')?.close(); true`)
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000),
      'the title card the check above opened did not close',
    )
    type Shown = { opacity: string; unfinished: string[] }
    const shown = await browser.evaluate<Shown | null>(`(async () => {
      const start = performance.now()
      document.querySelector('.ab-grid .ab-link').click()
      let card
      while (!(card = document.querySelector('dialog.ab-card'))?.open && performance.now() - start < 5000)
        await new Promise((resolve) => setTimeout(resolve, 5))
      if (!card?.open) return null
      await new Promise((resolve) => setTimeout(resolve, 400))
      // Then two frames, so that what is read has been drawn.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        opacity: getComputedStyle(card).opacity,
        unfinished: document.getAnimations().filter((a) => a.playState !== 'finished').map((a) => {
          const { target, pseudoElement } = a.effect
          const where = target === card && !pseudoElement ? 'the card' : [target.localName, ...target.classList].join('.') + (pseudoElement ?? '')
          return where + ': ' + (a.animationName ?? (a.transitionProperty ? 'a transition of ' + a.transitionProperty : 'a script’s animation')) + ', ' + a.playState
        }),
      }
    })()`)
    // Closed before anything fails, so the checks below start with no card open.
    await browser.press('Escape')
    assert.ok(shown, 'the title card did not open')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000),
      'the title card did not close',
    )
    assert.deepEqual(
      shown,
      { opacity: '1', unfinished: [] },
      'the title card 400 ms after it opened, by the page’s own clock: its opacity, and each animation on the page not yet finished (where it runs, what it is, and whether it is running or paused)',
    )
  })

  test('closing a title card with Esc runs one fade of 150 ms or less, no frame of it changes a quarter of the screen, and focus goes back to its panel', async () => {
    // The card fades out over 150 ms as it closes, as it fades in: gone at once, it changed 76% of
    // the screen here in a single frame, the cut the fade in replaced (R1). It is opened as a
    // visitor opens it, with Enter on a panel: the browser lets the page hold a dialog open on Esc
    // only once the visitor has done something on the page, so Esc on a card a script opened
    // still closes it at once. As for the opening, each animation the closing starts is noted and
    // held as it starts, then played by hand one 60 Hz frame at a time, each frame compared with
    // the one before. Once the fade has played, the card must leave the page, and the focus be
    // back on the panel that opened it, where the browser puts it as the dialog closes.
    try {
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
      await browser.evaluate(`(() => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.focus()
        return true
      })()`)
      await browser.press('Enter')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      await screenChange(true)
      await browser.evaluate(watchClosing(true))
      await browser.press('Escape')
      const started = await browser.evaluate<string[] | null>('window.__closingStarted')
      assert.ok(started, 'the title card did not start to close')
      // Frames up to the closing's end, and one past it; 300 ms at most, as longer fails anyway.
      const end = await browser.evaluate<number>(
        `Math.min(300, Math.max(0, ...window.__closing.map((a) => a.effect.getComputedTiming().endTime)))`,
      )
      const frames = [...Array(Math.ceil((end * 60) / 1000)).keys()].map((k) => (k * 1000) / 60)
      const changed: number[] = []
      for (const at of [...frames, end + 1]) {
        await browser.evaluate(`(() => {
          for (const a of window.__closing) a.currentTime = ${at}
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
        })()`)
        changed.push((await screenChange()) ?? 0)
      }
      // Held, a fade set past its end has ended but never finishes, so it is finished here, unless
      // it is endless, which can't be: the page may close the card as the fade ends or once it has
      // finished.
      await browser.evaluate(
        `for (const a of window.__closing) if (a.playState === 'paused' && a.effect.getComputedTiming().endTime !== Infinity) a.finish(); true`,
      )
      const gone = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
      const focus = await browser.evaluate<string>(focusPlace)
      const most = Math.max(...changed)
      assert.deepEqual(
        {
          started,
          most: most < 25 ? 'under a quarter' : `${most}%`,
          card: gone ? 'gone' : 'still on the page',
          focus,
        },
        {
          started: ['the card: opacity, in 150 ms or less, once'],
          most: 'under a quarter',
          card: 'gone',
          focus: 'back on its panel',
        },
        'closing the title card with Esc: the animations it started (where each ran, what its keyframes change, how long it took and how often it ran), the most of the screen one 60 Hz frame of it changed, whether the card left the page once the fade had played, and where the focus went',
      )
    } finally {
      await closeCardLeft()
    }
  })

  test('a title card closed with its button fades out and is gone 400 ms later, by the page’s own clock, with focus back on its panel', async () => {
    // The button closes the card as Esc does, with the same fade, here opened and closed with the
    // mouse and played by the page itself, on the clock the fade runs on. 400 ms after the closing
    // starts, well past the 150 ms fade, the card must have left the page, and the focus be back
    // on the panel that opened it. A fade held on its first frame, or a card kept on the page once
    // it has faded, leaves the card open, and the page behind it out of reach.
    try {
      await browser.evaluate(`(async () => {
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return true
      })()`)
      await clickMiddle('window.__opener')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      // The mouse goes to the button first, as a visitor's does: hovered, it turns red, a change
      // of color with a 250 ms transition of its own, which closing doesn't start.
      await hoverClose(true)
      await browser.evaluate(watchClosing(false))
      await clickMiddle(`document.querySelector('dialog.ab-card .ab-close')`)
      const started = await browser.evaluate<string[] | null>('window.__closingStarted')
      assert.ok(started, 'the title card did not start to close')
      const after = await browser.evaluate<{ card: string; focus: string }>(closed400msOn)
      assert.deepEqual(
        { started, ...after },
        {
          started: ['the card: opacity, in 150 ms or less, once'],
          card: 'gone',
          focus: 'back on its panel',
        },
        'closing the title card with its button: the animations it started (where each ran, what its keyframes change, how long it took and how often it ran), then 400 ms on, by the page’s own clock, whether the card had left the page, and where the focus was',
      )
    } finally {
      await closeCardLeft()
    }
  })

  test('a second request to close a title card as it fades out, with Esc or its button, closes it at once, with focus back on its panel', async () => {
    // Asked to close again while it fades out, the card must close at once, as TitleCard says, not
    // wait for the fade to end. The page hears the button and Esc in different places, so each
    // comes second once: the button after Esc, then Esc after the button. Not Esc twice: the
    // browser lets the page hold the card on Esc once for each thing the visitor does, such as a
    // click, so a second Esc in a row closes it whatever the page does. The card is opened with the
    // mouse, so that the page may hold it on the first Esc, and the fade is held as it starts, so
    // that the second request comes mid-fade however slow the machine, and only that request can
    // close the card. No frame may then be drawn before the dialog closes; the card must leave the
    // page, and the focus go back to its panel, as for a single request. A request that waited for
    // the fade would leave the held card open for good; with the fade playing, the card closed
    // 7-10 frames (130-190 ms) after the request.
    const request = {
      Esc: () => browser.press('Escape'),
      'the button': () => clickMiddle(`document.querySelector('dialog.ab-card .ab-close')`),
    }
    const seen: Record<string, object> = {}
    for (const [first, second] of [
      ['Esc', 'the button'],
      ['the button', 'Esc'],
    ] as const) {
      try {
        await browser.evaluate(`(async () => {
          window.__opener = document.querySelector('.ab-grid .ab-link')
          window.__opener.scrollIntoView({ block: 'center' })
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return true
        })()`)
        await clickMiddle('window.__opener')
        assert.ok(
          await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
          'the title card did not open',
        )
        await cardInFull()
        // Hovered, the button turns red, with a transition of its own that closing doesn't start.
        if (first === 'the button') await hoverClose(true)
        await browser.evaluate(watchClosing(true))
        await request[first]()
        const started = await browser.evaluate<string[] | null>('window.__closingStarted')
        await browser.evaluate(watchSecondRequest)
        await request[second]()
        const closed = await browser.evaluate<string>('window.__secondRequest')
        const gone = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
        const focus = await browser.evaluate<string>(focusPlace)
        seen[`${first}, then ${second}`] = {
          started,
          closed,
          card: gone ? 'gone' : 'still on the page',
          focus,
        }
      } finally {
        await closeCardLeft()
      }
    }
    const atOnce = {
      started: ['the card: opacity, in 150 ms or less, once'],
      closed: 'before the next frame',
      card: 'gone',
      focus: 'back on its panel',
    }
    // Esc makes the browser show the keyboard's focus, which is on the close button, so on the
    // opened card the button takes its focus look as the card fades: under reduced motion, a
    // change of color, each with its own 250 ms transition.
    const focusLook = [
      'button.ab-close: background-color, in 250 ms, once',
      'button.ab-close: border-bottom-color, in 250 ms, once',
      'button.ab-close: border-left-color, in 250 ms, once',
      'button.ab-close: border-right-color, in 250 ms, once',
      'button.ab-close: border-top-color, in 250 ms, once',
      'span.ab-x: color, in 250 ms, once',
    ]
    assert.deepEqual(
      seen,
      {
        'Esc, then the button': { ...atOnce, started: [...focusLook, ...atOnce.started] },
        'the button, then Esc': atOnce,
      },
      'a second request to close the title card as it faded out, each way round: the animations the first request started (held as they started), how soon the dialog closed after the second, whether the card left the page, and where the focus went',
    )
  })

  test('with every animation turned off by a stylesheet of the visitor’s own, Esc still closes a title card, with focus back on its panel', async () => {
    // Some browser extensions for visitors who reduce motion turn off every animation with a
    // stylesheet of their own, the card's fades included. With no fade to end, the card must close
    // all the same once the fade would have played (see TitleCard), not stay open over a page out
    // of reach. So 400 ms after Esc starts the closing, by the page's own clock, it must have left
    // the page, having run no animation.
    try {
      await browser.evaluate(`(() => {
        const visitors = document.createElement('style')
        visitors.id = 'visitors-own'
        visitors.textContent = '*, *::before, *::after { animation: none !important }'
        document.head.append(visitors)
        window.__opener = document.querySelector('.ab-grid .ab-link')
        window.__opener.focus()
        return true
      })()`)
      await browser.press('Enter')
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
        'the title card did not open',
      )
      await cardInFull()
      await browser.evaluate(watchClosing(false))
      await browser.press('Escape')
      const started = await browser.evaluate<string[] | null>('window.__closingStarted')
      assert.ok(started, 'the title card did not start to close')
      const after = await browser.evaluate<{ card: string; focus: string }>(closed400msOn)
      assert.deepEqual(
        { started, ...after },
        { started: [], card: 'gone', focus: 'back on its panel' },
        'closing the title card with Esc, every animation turned off: the animations it started, then 400 ms on, by the page’s own clock, whether the card had left the page, and where the focus was',
      )
    } finally {
      await browser.evaluate(`document.getElementById('visitors-own')?.remove(); true`)
      await closeCardLeft()
    }
  })

  test('hovering a panel or holding the lever moves nothing', async () => {
    await browser.evaluate(`document.querySelector('dialog.ab-card')?.close(); true`)
    await sleep(300)
    const centerOf = (selector: string) =>
      browser.evaluate<{ x: number; y: number }>(
        `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
      )
    const movingTransitions = `document.getAnimations().filter((a) => /transform|width/.test(a.transitionProperty ?? '')).length`
    await browser.evaluate(`document.querySelector('#ab-trending').scrollIntoView(); true`)
    let at = await centerOf('.ab-grid .ab-link')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(120)
    const onHover = await browser.evaluate<number>(movingTransitions)
    // A zoom can also apply at once, with no transition to count.
    const cover = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-grid .ab-link .ab-img img')).transform`,
    )
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    at = await centerOf('.ab-lever')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...at,
      button: 'left',
      clickCount: 1,
    })
    await sleep(120)
    const lever = await browser.evaluate<string>(
      `getComputedStyle(document.querySelector('.ab-lever')).transform`,
    )
    const onPress = await browser.evaluate<number>(movingTransitions)
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...at,
      button: 'left',
      clickCount: 1,
    })
    assert.equal(onHover, 0, 'hovering a panel started a moving transition')
    assert.equal(cover, 'none', 'the hovered cover zoomed')
    assert.equal(onPress, 0, 'pressing the lever started a moving transition')
    assert.equal(lever, 'none', 'the held lever turned')
  })

  test('hovering the lever still shows it can be pulled, without moving it', async () => {
    await browser.evaluate(`document.querySelector('#pull').scrollIntoView(); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('.ab-lever').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    type Look = { shadow: string; fill: string; transform: string }
    const look = `(() => { const s = getComputedStyle(document.querySelector('.ab-lever')); return { shadow: s.boxShadow, fill: s.backgroundColor, transform: s.transform } })()`
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 200, y: at.y })
    await sleep(300)
    const resting = await browser.evaluate<Look>(look)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await sleep(300) // longer than the 0.15s shadow transition
    const hovered = await browser.evaluate<Look>(look)
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x - 200, y: at.y })
    assert.ok(
      hovered.shadow !== resting.shadow || hovered.fill !== resting.fill,
      'hovering the lever changed nothing',
    )
    assert.equal(hovered.transform, 'none', 'the hovered lever moved')
  })

  test('the splash cover stays still as the page scrolls it away', async () => {
    // The drift that the desktop check sees with motion allowed must not run here.
    await scrollSplashOut(0.5)
    const halfOut = await browser.evaluate<string>(splashCover)
    await browser.evaluate('scrollTo(0, 0); true')
    assert.equal(halfOut, 'none', 'the splash cover drifted with half its panel scrolled away')
  })

  test('a pull shows no capsule halves', async () => {
    // With motion allowed, a capsule drops in and splits open on the title (see the desktop
    // group). Here the title comes out at once, with no capsule: not even a still one for the
    // frame or so before it opens.
    assert.deepEqual(
      await capsuleHalves(),
      { pulled: 0, opened: 0 },
      'capsule halves shown as the pull began, and once it opened',
    )
  })

  test('a pull never shows the title already on screen, even once every title has come up', async () => {
    // A pull that lands on the title already showing looks like the lever did nothing. With
    // Math.random fixed, each pull draws the same place in its list: once every title has come
    // up, that is the same title every time, unless the one showing is skipped. Reduced motion
    // opens each capsule at once, so 100 pulls take about a second.
    const shown = await browser.evaluate<(string | null)[]>(`(async () => {
      const random = Math.random
      Math.random = () => 0.5
      const shown = []
      try {
        for (let i = 0; i < 100; i++) {
          document.querySelector('.ab-result')?.setAttribute('data-old', '')
          document.querySelector('.ab-lever').click()
          let panel = null
          for (let wait = 0; wait < 100 && !(panel = document.querySelector('.ab-result.is-open:not([data-old]) .ab-result-panel')); wait++)
            await new Promise((resolve) => setTimeout(resolve, 5))
          shown.push(panel?.getAttribute('href') ?? null)
        }
      } finally {
        Math.random = random
      }
      return shown
    })()`)
    const unopened = shown.flatMap((href, i) => (href ? [] : [i + 1]))
    const repeats = shown.flatMap((href, i) =>
      i > 0 && href === shown[i - 1] ? [`pull ${i + 1}: ${href}`] : [],
    )
    assert.deepEqual(unopened, [], 'pulls that never opened')
    assert.deepEqual(repeats, [], 'pulls that showed the title already on screen')
  })

  test('picking another decade opens it at Ch.1, wherever the last one was scrolled', async () => {
    // The page keeps the decade row for the next decade's titles, so a new decade used to open
    // wherever the visitor had scrolled the last one. With reduced motion nothing pops in, so
    // where the row is when the new titles go in is what the visitor sees.
    const first = `${decadeRow}?.querySelector('.ab-strip-title')?.textContent`
    const nineties = await browser.evaluate<string>(first)
    await browser.evaluate(`document.querySelector('.ab-eras input[value="1980s"]').click(); true`)
    assert.ok(
      await browser.waitFor(`${first} && ${first} !== ${JSON.stringify(nineties)}`),
      'the strip kept the 1990s titles',
    )
    await browser.evaluate(
      `${decadeRow}.scrollTo({ left: ${decadeRow}.scrollWidth, behavior: 'instant' }); true`,
    )
    await rowSettled()
    const scrolled = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    // Back to the 1990s, which the page loaded first, so they come from the cache. That switch
    // shows whether the reset waits for paint: React draws cached titles in an update whose
    // effects can run after paint, while a fetched list arrives in one whose effects all run
    // first. The row's place is read as soon as the first title changes, before the browser
    // paints.
    const atSwap = await browser.evaluate<number | null>(`new Promise((resolve) => {
      const section = document.querySelector('[aria-labelledby="decades"]')
      const row = () => section.querySelector('.ab-strip-row:not([aria-hidden])')
      const before = row().querySelector('.ab-strip-title').textContent
      const watch = new MutationObserver(() => {
        if (row()?.querySelector('.ab-strip-title')?.textContent === before) return
        watch.disconnect()
        resolve(row().scrollLeft)
      })
      watch.observe(section, { childList: true, subtree: true })
      setTimeout(() => resolve(null), 5000)
      document.querySelector('.ab-eras input[value="1990s"]').click()
    })`)
    await rowSettled()
    const atRest = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    assert.ok(scrolled > 0, 'the 1980s row did not scroll')
    assert.notEqual(atSwap, null, 'the 1990s titles never replaced the 1980s')
    assert.deepEqual(
      { atSwap, atRest },
      { atSwap: 0, atRest: 0 },
      'the 1990s did not open at Ch.1 (the row’s scrollLeft when their titles went in, and at rest)',
    )
  })

  test('opening a title card elsewhere leaves the decade row where the visitor left it', async () => {
    // Only a new list starts at Ch.1. The page draws the strip again, with the same titles,
    // whenever anything on it changes, such as a title card opening or closing; the visitor's
    // place must stay.
    await browser.evaluate(`(() => {
      const row = ${decadeRow}
      row.scrollTo({ left: row.children[5].offsetLeft - parseFloat(getComputedStyle(row).scrollPaddingLeft), behavior: 'instant' })
      return true
    })()`)
    await rowSettled()
    const before = await browser.evaluate<number>(`${decadeRow}.scrollLeft`)
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').click(); true`)
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
      'the title card did not open',
    )
    await browser.press('Escape')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000),
      'the title card did not close',
    )
    await rowSettled()
    assert.ok(before > 0, 'the decade row did not scroll')
    assert.equal(
      await browser.evaluate<number>(`${decadeRow}.scrollLeft`),
      before,
      'opening and closing a title card moved the decade row',
    )
  })

  // Only the device locks the Reduce motion switch: set on the site, the setting can be turned off
  // again (see the desktop group).
  if (askedOn === 'device')
    test('the Reduce motion switch shows on and locked, says why, and stays focusable', async () => {
      // While the device asks for reduced motion, motion stays reduced whatever the site says, so
      // the switch shows on and locked, though the site's own setting is off: yellow, flat and
      // dashed, with a line saying why. It stays focusable, marked aria-disabled rather than
      // disabled, so a screen reader reaches it and hears the line, which aria-describedby ties to
      // it: the line is its description in Chrome's accessibility tree. A sighted visitor must be
      // able to read the line too: a box of 200x16px or more, not clipped away (as sr-only keeps
      // text for screen readers alone), and 4.5:1 or better as the screen shows it. It is about
      // 303x20px, at 16:1, today. A click or Space changes nothing, not even a choice saved on an
      // earlier visit, which holds again once the device stops asking, and the switch sends no
      // change or input event, as for a change that never happened.
      assert.ok(await hasSwitch(), 'the footer has no Reduce motion switch')
      await tabToSwitch()
      const reached = await readSwitch()
      const seen = await readWhyLine()
      assert.deepEqual(
        {
          checked: reached.checked,
          locked: reached.locked,
          focused: reached.focused,
          ring: reached.ring,
          why: reached.why,
          seen,
          description: reached.description,
          look: reached.look,
          motion: reached.motion,
        },
        {
          checked: true,
          locked: 'true',
          focused: true,
          ring: 'brand hot',
          why: 'On because your device is set to reduce motion.',
          seen: { size: '200x16px or more', clip: 'none', contrast: '4.5:1 or better' },
          description: 'On because your device is set to reduce motion.',
          look: { fill: 'rgb(255, 212, 0)', border: 'dashed', shadow: 'none', lift: 'none' },
          motion: null,
        },
        'the switch as Tab reached it, with the device asking and the site’s setting off: on, aria-disabled, focused from the keyboard, its ring, the line that says why and how it shows (its size, clip-path and contrast on screen), the description a screen reader reads out, its chip’s fill, border, shadow and lift, and data-motion on <html>',
      )
      try {
        await browser.evaluate(`localStorage.setItem('anibeam:motion', 'reduce'); true`)
        await browser.load({ reduceMotion: true })
        await tabToSwitch()
        await browser.evaluate(`(() => {
          window.__changes = 0
          for (const type of ['change', 'input']) ${motionSwitch}.addEventListener(type, () => window.__changes++)
          return true
        })()`)
        await browser.press('Space')
        await clickSwitch()
        const { checked, motion, saved } = await readSwitch()
        const events = await browser.evaluate<number>('window.__changes')
        assert.deepEqual(
          { checked, motion, saved, events },
          { checked: true, motion: 'reduce', saved: 'reduce', events: 0 },
          'after Space and a click on the locked switch, with a choice saved on an earlier visit: on, data-motion on <html>, the saved choice, and the change and input events it sent',
        )
      } finally {
        await browser.evaluate(`localStorage.removeItem('anibeam:motion'); true`)
      }
    })

  // Set on the site, the setting is turned off by the switch instead (see the saved group below).
  if (askedOn === 'device')
    test('as the device stops asking for reduced motion, no entrance already on the page replays, and the next pull moves in full', async () => {
      // Motion back on, every rule in the motion gates applies again, and their animations would
      // start over on what is already on the page: some 60 entrances, and after a pull, the
      // capsule dropping and splitting again over the title it gave. Each must finish at once
      // instead (see watchMotionBackOn() in lib/motion.ts), while what arrives later plays as
      // usual. The device stops asking with the splash cover half scrolled away, mid-drift: its
      // drift runs on the scroll, not the clock, and must go on following it. Chrome draws a frame
      // with motion back on before it tells the page, and that frame must show no entrance
      // starting over either: the reading is in it (see motionBackOn).
      await browser.load({ reduceMotion: true })
      assert.ok(await browser.titlesShown())
      const seen = await motionBackOn(async () => {
        await scrollSplashOut(0.5)
        await browser.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        })
      })
      assert.deepEqual(
        seen,
        BACK_ON,
        'after a pull, as the device stopped asking: in the first frame drawn after, motion, each animation on the page’s clock left unfinished and the capsule halves over the open title; then how the switch’s knob moved, the splash cover just before its panel leaves the screen and half out, and each animation of the next pull',
      )
    })

  // Only the device's setting can change while a title card is open: the switch lies behind it,
  // out of reach.
  if (askedOn === 'device')
    test('as the device stops asking for reduced motion while a title card fades out, the card still closes, with focus back on its panel', async () => {
      // Motion back on, the motion block's rules apply again. Its animation: none, which swaps the
      // card's fade in for the wipe, must not cut the fade out short, as that would leave the card
      // open with no fade left to end: finishEntrances() finishes the fade instead (see
      // lib/motion.ts), and the card closes. The fade is held as it starts, so that the device
      // changes while it plays.
      await browser.load({ reduceMotion: true })
      assert.ok(await browser.titlesShown())
      try {
        await browser.evaluate(`(() => {
          window.__opener = document.querySelector('.ab-grid .ab-link')
          window.__opener.focus()
          return true
        })()`)
        await browser.press('Enter')
        assert.ok(
          await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
          'the title card did not open',
        )
        await cardInFull()
        await browser.evaluate(watchClosing(true))
        await browser.press('Escape')
        const started = await browser.evaluate<string[] | null>('window.__closingStarted')
        assert.ok(started, 'the title card did not start to close')
        await browser.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        })
        const gone = await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000)
        const focus = await browser.evaluate<string>(focusPlace)
        assert.deepEqual(
          { started, card: gone ? 'gone' : 'still on the page', focus },
          {
            started: ['the card: opacity, in 150 ms or less, once'],
            card: 'gone',
            focus: 'back on its panel',
          },
          'closing the title card with Esc as the device stopped asking for reduced motion mid-fade: the animations the closing started, whether the card left the page, and where the focus went',
        )
      } finally {
        await closeCardLeft()
      }
    })
}

// The site's setting is saved while it is on (see lib/motion.ts), and main.tsx puts it back on
// <html> before the page first renders, so a later visit starts as still as the last one ended.
// The page's entrances start as soon as it is drawn: turned on any later, as in the group above,
// the setting would let them play.
describe('reduced motion, saved on the site', () => {
  test('with the choice saved, a fresh load starts no animation', async () => {
    // Each animation the page starts, as "name on element", heard from its first moment: the
    // listener goes in before the page's own scripts run. One stopped before its delay is up
    // sends animationcancel instead of animationstart, though it held its element in its first
    // frame until then (fill-mode both or backwards), so that counts too.
    const { identifier } = await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__started = []
        for (const type of ['animationstart', 'animationcancel'])
          addEventListener(type, ({ animationName, target, pseudoElement }) => {
            const owner = target.closest('[class]')
            const element = owner === target ? '.' + target.classList[0] : target.localName + ' in .' + owner?.classList[0]
            window.__started.push(animationName + ' on ' + element + pseudoElement)
          }, true)`,
    })
    // A fresh load on a device that allows motion, read once every animation it started has
    // finished: whether <html> has the site's setting, and which animations started.
    const load = async () => {
      await browser.load()
      assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
      await browser.animationsDone()
      return browser.evaluate<{ motion: string | null; started: string[] }>(
        `({ motion: document.documentElement.dataset.motion ?? null, started: [...new Set(window.__started)].sort() })`,
      )
    }
    try {
      // First with nothing saved, when the entrances play: the listener must hear them, so that
      // one that hears nothing can't pass.
      const allowed = await load()
      await browser.evaluate(`localStorage.setItem('anibeam:motion', 'reduce'); true`)
      const saved = await load()
      assert.equal(allowed.motion, null, 'with nothing saved, a fresh load turned the setting on')
      assert.notDeepEqual(
        allowed.started,
        [],
        'with nothing saved, the listener heard no animation start, so it can’t be trusted to hear one',
      )
      assert.deepEqual(
        saved,
        { motion: 'reduce', started: [] },
        'with the choice saved, a fresh load’s data-motion on <html>, and the animations it started',
      )
    } finally {
      await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
      // Forgotten again, so the checks after this one load with motion allowed.
      await browser.evaluate(`localStorage.removeItem('anibeam:motion'); true`)
    }
  })

  test('the Reduce motion switch’s choice outlasts the visit, on or off', async () => {
    // A click turns the footer's switch on and saves the choice, so the next visit starts with it:
    // shown on, with the setting on <html> from the first frame (see the check above). Another
    // click turns it off and forgets the choice, so the visit after that starts with motion, as a
    // first one does. Each click flips the switch from whatever its visit showed.
    try {
      await browser.load()
      assert.ok(await hasSwitch(), 'the footer has no Reduce motion switch')
      const visits: unknown[] = []
      for (let click = 0; click < 2; click++) {
        const was = await browser.evaluate<boolean>(`${motionSwitch}.checked`)
        await clickSwitch()
        assert.ok(
          await browser.waitFor(`${motionSwitch}.checked === ${!was}`, 5000),
          'a click did not flip the switch',
        )
        await browser.load()
        visits.push(
          await browser.evaluate(
            `({ checked: ${motionSwitch}?.checked ?? null, motion: document.documentElement.dataset.motion ?? null })`,
          ),
        )
      }
      assert.deepEqual(
        visits,
        [
          { checked: true, motion: 'reduce' },
          { checked: false, motion: null },
        ],
        'the next visit after a click turned the switch on, then after another click: the switch, and data-motion on <html>',
      )
    } finally {
      await browser.evaluate(`localStorage.removeItem('anibeam:motion'); true`)
    }
  })

  test('turning the Reduce motion switch off replays no entrance already on the page, and the next pull moves in full', async () => {
    // As when the device stops asking (see the reduced motion group): turned off, the switch lets
    // every rule in the motion gates apply again, and the animations already on the page must
    // finish at once, the capsule's included, while the knob slides off and a new pull plays. A
    // visitor whose choice was saved pulls a title, then clicks the switch off, at the footer,
    // where the decade row's 20 panels would pop in again. The splash drift must still follow the
    // scroll: finished there, where its panel has long left the screen, it would never move again.
    try {
      await browser.load()
      await browser.evaluate(`localStorage.setItem('anibeam:motion', 'reduce'); true`)
      await browser.load()
      assert.ok(await browser.titlesShown(), 'trending and decade titles never appeared')
      assert.deepEqual(
        await motionBackOn(clickSwitch),
        BACK_ON,
        'after a pull, as a click turned the switch off: in the first frame drawn after, motion, each animation on the page’s clock left unfinished and the capsule halves over the open title; then how the switch’s knob moved, the splash cover just before its panel leaves the screen and half out, and each animation of the next pull',
      )
    } finally {
      await browser.evaluate(`localStorage.removeItem('anibeam:motion'); true`)
    }
  })
})

describe('phone (390x844)', () => {
  // Phone emulation widens the layout to fit anything too wide, so overflow is measured
  // against the device's real width, not innerWidth.
  const fits = `innerWidth === 390 && document.documentElement.scrollWidth <= 390`

  before(async () => {
    await browser.load({ width: 390, height: 844, phone: true })
    assert.ok(await browser.titlesShown())
  })

  test('the intro fills the first screen, nothing overflows, and the decade chips wrap', async () => {
    const phone = await browser.evaluate<{
      trendingTop: number
      introMin: number
      header: number
      fits: boolean
      chipRows: number
    }>(`({
      trendingTop: document.querySelector('.ab-page').getBoundingClientRect().top,
      introMin: parseFloat(getComputedStyle(document.querySelector('.ab-intro')).minHeight),
      header: document.querySelector('.ab-top').offsetHeight,
      fits: ${fits},
      chipRows: new Set([...document.querySelectorAll('.ab-eras .ab-chip')].map((c) => Math.round(c.getBoundingClientRect().top))).size,
    })`)
    assert.ok(phone.trendingTop >= 843, `trending starts at ${phone.trendingTop}px`)
    // On a phone the intro's content is taller than the room under the header, so where trending
    // starts can't show whether the intro was sized by the header's height (--top-h). Its
    // minimum height can: the screen under the header. Without --top-h it was the whole screen.
    assert.ok(
      Math.abs(phone.introMin - (844 - phone.header)) <= 1,
      `the intro's minimum height is ${phone.introMin}px, not the ${844 - phone.header}px under the ${phone.header}px header`,
    )
    assert.ok(phone.fits, 'the page is wider than the phone')
    assert.ok(phone.chipRows >= 2)
  })

  test('the intro is drawn where it stays, from its first frame', async () => {
    // On a phone the header takes three rows, 230px. Sized by the 80px fallback, the first frame
    // drew the headline 67px lower than where it then jumped: layout shifts of about 0.04, in one
    // to three frames, on every load. Chrome's phone emulation marks these shifts as just after
    // input (which web-vitals would skip), though no key or click was sent; a plain window of the
    // same size reports the same shifts without the mark, as a visitor's would. So every one
    // counts (see introMovesOnLoad).
    // A tablet in portrait takes two rows, 134px, on a taller screen. The phone comes last, so
    // the checks after this one see the page their group loaded.
    const moved: string[] = []
    for (const [width, height] of [
      [768, 1024],
      [390, 844],
    ])
      for (const part of await introMovesOnLoad({ width, height, phone: true }))
        moved.push(`${width}x${height}: ${part}`)
    // And once reloaded, as a visitor's browser button does.
    for (const part of await introMovesOnReload()) moved.push(`390x844, reloaded: ${part}`)
    assert.deepEqual(moved, [], 'parts of the intro that moved after they were drawn')
  })

  test('the intro’s speed lines stay under the header', async () => {
    // The intro's speed lines reach up behind the header. On a phone the header scrolls away
    // with the page instead of sticking, but it should still cover them, as it does on
    // desktop, so it looks the same with the lines hidden.
    await browser.animationsDone()
    await browser.evaluate('scrollTo(0, 0); true')
    const header = await browser.evaluate<{ x: number; y: number; width: number; height: number }>(
      `(() => { const r = document.querySelector('.ab-top').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } })()`,
    )
    const withLines = await browser.screenshot(header)
    // Hide them, and wait two frames, so the page has painted without them.
    await browser.evaluate(`(() => {
      const style = document.head.appendChild(document.createElement('style'))
      style.id = 'no-speed-lines'
      style.textContent = '.ab-intro::before { content: none }'
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))
    })()`)
    const withoutLines = await browser.screenshot(header)
    await browser.evaluate(`document.getElementById('no-speed-lines').remove(); true`)
    // Not assert.equal, which would print both PNGs in full.
    assert.ok(withLines === withoutLines, 'the intro’s speed lines paint over the header')
  })

  test('with WCAG text spacing, no word in the intro is cut off or pushed out of its box', async () => {
    // Some readers widen the spacing of letters, words and lines to read more easily, and WCAG
    // 1.4.12 asks that no text is lost when they do. With its test spacing on, at two phone
    // widths and a desktop one, this lists each word of the intro that ends up past the intro's
    // padding, where the intro cuts it off, or outside its own box (on desktop, under the
    // covers). The sound effect is decoration (aria-hidden), so it is left out.
    await browser.animationsDone() // the lines rise into place; measure them once they have landed
    await browser.evaluate(`(() => {
      const style = document.head.appendChild(document.createElement('style'))
      style.id = 'text-spacing'
      style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
      return true
    })()`)
    const lost: string[] = []
    // All at this describe's 2x density. At 1x, decade covers that come within lazy-loading
    // range of the shorter desktop page would load their 1x file and keep it on the phone,
    // where the 2x cover check below would find them blurry.
    for (const [width, height, mobile] of [
      [390, 844, true],
      [320, 568, true],
      [1024, 768, false],
    ] as const) {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile,
      })
      const words = await browser.evaluate<string[]>(`(() => {
        const intro = document.querySelector('.ab-intro'), box = intro.getBoundingClientRect(), style = getComputedStyle(intro)
        const left = box.left + parseFloat(style.paddingLeft), right = box.right - parseFloat(style.paddingRight)
        const lost = []
        for (const block of intro.querySelectorAll('.ab-intro-kicker, .ab-intro-title, .ab-intro-lede, .ab-intro-actions a')) {
          const own = block.getBoundingClientRect(), text = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
          for (let node; (node = text.nextNode()); ) {
            if (node.parentElement.closest('[aria-hidden="true"]')) continue
            for (const word of node.data.matchAll(/\\S+/g)) {
              const range = document.createRange()
              range.setStart(node, word.index)
              range.setEnd(node, word.index + word[0].length)
              for (const r of range.getClientRects())
                if (r.left < Math.max(left, own.left) - 0.5 || r.right > Math.min(right, own.right) + 0.5) lost.push(word[0])
            }
          }
        }
        return lost
      })()`)
      lost.push(...words.map((word) => `${width}px: ${word}`))
    }
    // Back to the normal view on this describe's phone before anything is asserted, so the
    // checks after this one see the screen they expect.
    await browser.evaluate(`document.getElementById('text-spacing').remove(); true`)
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    // The sound effect hangs off the end of the first line, with no width of its own, so it
    // must not wrap one katakana per line.
    const effectLines = await browser.evaluate<number>(`(() => {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('.ab-intro-sfx'))
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
    })()`)
    assert.deepEqual(lost, [], 'words in the intro cut off or pushed out of their box')
    assert.equal(effectLines, 1, 'the intro’s sound effect wraps onto more than one line')
  })

  test('every menu item fits on screen without squeezing', async () => {
    const menu = await browser.evaluate<{ right: number; soonHeight: number }>(`({
      right: Math.max(...[...document.querySelectorAll('.ab-nav > *')].map((n) => n.getBoundingClientRect().right)),
      soonHeight: document.querySelector('.ab-nav .ab-soon').getBoundingClientRect().height,
    })`)
    assert.ok(menu.right <= 374, `the menu ends at ${menu.right}px`)
    assert.ok(menu.soonHeight <= 50, `the coming-soon pill is ${menu.soonHeight}px tall`)
  })

  test('on a 2x screen, decade covers load AniList’s 460px file where there is one', async () => {
    // A decade cover is 142px wide here: 284 pixels on this 2x screen. AniList's `large` file
    // is 230px wide, so it was blown up and looked soft. Where AniList also has a 460px file
    // (extraLarge), a 2x screen should load that one instead.
    assert.equal(await browser.evaluate('devicePixelRatio'), 2, 'the phone checks need a 2x screen')
    await browser.evaluate(`${decadeRow}.scrollIntoView({ block: 'center' }); true`)
    assert.ok(
      await browser.waitFor(
        `[...${decadeRow}.querySelectorAll('img')].slice(0, 2).every((img) => img.complete && img.naturalWidth)`,
      ),
      'the first decade covers never loaded',
    )
    // For each cover that has loaded: whether it offers a bigger file, the size of the file it
    // shows, and the size of its box in device pixels. A 2x file's naturalWidth is halved (460
    // reads 230), so the shown file is loaded again on its own to read its real size.
    type Cover = { title: string; offers: boolean; file: number[]; box: number[] }
    const covers = await browser.evaluate<Cover[]>(`Promise.all(
      [...${decadeRow}.querySelectorAll('img')]
        .filter((img) => img.complete && img.naturalWidth)
        .map(async (img) => {
          const file = new Image()
          file.src = img.currentSrc
          await file.decode()
          return {
            title: img.closest('a').querySelector('.ab-strip-title').textContent,
            offers: img.srcset !== '',
            file: [file.naturalWidth, file.naturalHeight],
            box: [img.offsetWidth, img.offsetHeight].map((px) => px * devicePixelRatio),
          }
        }),
    )`)
    const offering = covers.filter((cover) => cover.offers)
    assert.ok(
      offering.length >= 2,
      `only ${offering.length} of ${covers.length} loaded covers offer a bigger file`,
    )
    assert.deepEqual(
      offering
        .filter(({ file, box }) => file[0] < box[0] || file[1] < box[1])
        .map(
          ({ title, file, box }) => `${title}: a ${file.join('x')} file for a ${box.join('x')} box`,
        ),
      [],
      'covers that offer a bigger file but show a blurry one',
    )
  })

  test('on a phone, tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', async () => {
    assertStripInView(await tabThroughStrip())
  })

  test('a long search never pushes the page wider than the phone', async () => {
    await browser.search('The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life')
    assert.ok(await browser.waitFor(`document.querySelector('.ab-results')`, 5_000))
    await sleep(800)
    assert.ok(await browser.evaluate<boolean>(fits), 'the page is wider than the phone')
    await browser.search('')
  })

  test('search results show in a grid without sideways overflow', async () => {
    // Wait for this search's own heading: the check above has just cleared its long search, whose
    // result shows until the box has been still for 300 ms.
    await browser.search('one piece')
    assert.ok(
      await browser.waitFor(
        `${resultsFor('one piece')} && document.querySelector('.ab-results .ab-strip-panel[href]')`,
      ),
      'no One Piece results',
    )
    assert.ok(await browser.evaluate<boolean>(fits), 'the page is wider than the phone')
    await browser.search('')
  })

  test('on a phone, a new search’s first answer, arriving late, leaves the visitor’s place and focused chip where they were', async () => {
    // As on desktop, with another title: the answer for "macross" is saved, so it would show at
    // once. Here the header scrolls away with the page. No request is sent.
    assertPlaceKept(await lateFirstAnswer('patlabor'))
  })

  switchOnPhoneChecks(390)
})

describe('small phone (320x568, also a desktop window at 400% zoom)', () => {
  before(async () => {
    await browser.load({ width: 320, height: 568, phone: true })
    assert.ok(await browser.titlesShown())
  })

  test('the decade row rests at its first panel once the panels have popped in', async () => {
    await browser.animationsDone()
    await rowSettled()
    assert.equal(await browser.evaluate(`${decadeRow}.scrollLeft`), 0)
  })

  test('a small sideways scroll of the decade row comes to rest with a panel at its start', async () => {
    await browser.evaluate(`${decadeRow}.scrollIntoView({ block: 'center' }); true`)
    const at = await browser.evaluate<{ x: number; y: number }>(
      `(() => { const r = ${decadeRow}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`,
    )
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...at,
      deltaX: 40,
      deltaY: 0,
    })
    await sleep(300)
    await rowSettled()
    // At rest, some panel starts 8px into the row (the room left for its focus ring).
    const offset = await browser.evaluate<number>(`(() => {
      const row = ${decadeRow}, left = row.getBoundingClientRect().left
      return Math.min(...[...row.querySelectorAll('.ab-strip-panel')].map((p) => Math.abs(p.getBoundingClientRect().left - left - 8)))
    })()`)
    assert.ok(offset <= 1, `the row came to rest ${Math.round(offset)}px off a panel`)
    await browser.evaluate(`${decadeRow}.scrollTo({ left: 0 }); true`)
  })

  test('tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', async () => {
    assertStripInView(await tabThroughStrip())
  })

  switchOnPhoneChecks(320)
})

// The footer's Reduce motion switch on a phone `width`px wide, at the end of each phone group.
// Its other checks run at 1440x900, where the footer has room to spare.
function switchOnPhoneChecks(width: number) {
  test('the Reduce motion switch shows in full with a 44px target, and its skip link focuses it in view', async () => {
    // On a phone the footer is at its narrowest, and the switch must still show in full: its
    // target 44px tall or more, inside the page's side margins, with nothing pushed past the
    // screen's edge. A keyboard reaches it here too, from a phone with a keyboard or a desktop
    // window zoomed to 400%, which lays the page out as the small phone: as on desktop, the
    // second Tab from the top reaches "Skip to Reduce motion", and its Enter must focus the
    // switch in view, with its brand-hot ring. A switch hidden on phones would leave that link
    // leading nowhere. No line says why it is locked: the device allows motion.
    assert.ok(await hasSwitch(), 'the footer has no Reduce motion switch')
    // What the checks above left settles first: a search cleared at the end of one gives way to
    // the intro 300 ms later, and the intro's lines rise in again.
    assert.ok(
      await browser.waitFor(`document.querySelector('.ab-intro')`, 5000),
      'the intro never came back',
    )
    await browser.animationsDone()
    const shown = await readSwitchOnPhone(width)
    await fromTheTop()
    const tabs: string[] = []
    for (let press = 0; press < 2; press++) {
      await browser.press('Tab')
      tabs.push(await readFocus())
    }
    assert.deepEqual(
      tabs,
      [
        'Skip to content, ring brand hot, in view; skip links on screen: Skip to content',
        'Skip to Reduce motion, ring brand hot, in view; skip links on screen: Skip to Reduce motion',
      ],
      'what the first and the second Tab from the top of the page focused',
    )
    // Enter only once the link has focus: on the logo, say, it would leave the page.
    await browser.press('Enter')
    const jumped = await readFocus()
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    assert.deepEqual(
      { ...shown, jumped },
      {
        target: 'shown, 44px tall or more, inside the page’s side margins',
        line: null,
        page: 'no wider than the phone',
        jumped:
          'the Reduce motion switch (off), ring brand hot, in view; skip links on screen: none',
      },
      'the switch’s target, the line that says why it is locked, the page’s width, and what Enter on “Skip to Reduce motion” focused',
    )
  })

  test('locked on as the device asks, the Reduce motion switch’s line wraps under it, inside the page’s margins', async () => {
    // While the device asks for reduced motion, the line that says why the switch is locked shows
    // beside it where there is room, and under it on a phone. Here it must sit under the chip,
    // with its text wrapping inside the page's side margins: kept to one row, it would run 15px
    // into the small phone's right margin, to within 2px of the screen's edge. The switch must
    // still show in full, and the page be no wider than the phone. The device starts to ask
    // mid-visit, as in the contrast-theme check, and allows motion again once the switch is read.
    assert.ok(await hasSwitch(), 'the footer has no Reduce motion switch')
    try {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      })
      assert.ok(
        await browser.waitFor(`${motionSwitch}.getAttribute('aria-disabled') === 'true'`, 5000),
        'the switch did not lock as the device asked',
      )
      assert.deepEqual(
        await readSwitchOnPhone(width),
        {
          target: 'shown, 44px tall or more, inside the page’s side margins',
          line: 'under the chip, inside the page’s side margins',
          page: 'no wider than the phone',
        },
        'the locked switch’s target, the line that says why it is locked, and the page’s width',
      )
    } finally {
      // The device allows motion again, as load() set it.
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
      })
      await browser.waitFor(`!${motionSwitch}.hasAttribute('aria-disabled')`, 5000)
    }
  })
}

describe('Windows contrast themes (forced colors)', () => {
  // A contrast theme replaces the page's colors with a few the visitor picked (forced colors).
  // Chrome emulates one in a light palette and a dark one.
  before(async () => {
    await browser.load({ reduceMotion: true })
    assert.ok(await browser.titlesShown())
  })
  // Emulated media features are replaced as a whole: this clears forced colors.
  after(() => browser.send('Emulation.setEmulatedMedia', { features: [] }))

  test('the title card’s close button shows its X in both palettes, at rest and hovered, at 3:1 or better', async () => {
    // A theme paints every background in its page color, and the close button's X is drawn with
    // bars, which are backgrounds: it vanished into the button, an empty circle. In each palette,
    // the bars must stand out from the button at 3:1 or better, as an icon needs, at rest and
    // with the mouse on it (the red fill and the speed lines drop out, as the theme wants).
    const seen: string[] = []
    const theme = (scheme: string) =>
      browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
    const contrast = `(() => {
      const button = document.querySelector('dialog.ab-card .ab-close')
      const rgb = (color) => color.match(/[\\d.]+/g).slice(0, 3).map(Number)
      const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((sum, v, k) => sum + v * [0.2126, 0.7152, 0.0722][k], 0)
      const bars = getComputedStyle(button.querySelector('.ab-x i')).backgroundColor, fill = getComputedStyle(button).backgroundColor
      const [a, b] = [lum(rgb(bars)), lum(rgb(fill))].sort((x, y) => y - x)
      return { bars, fill, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 }
    })()`
    try {
      for (const scheme of ['light', 'dark']) {
        await theme(scheme)
        await browser.evaluate(`(async () => {
          window.__opener = document.querySelector('.ab-grid .ab-link')
          window.__opener.scrollIntoView({ block: 'center' })
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return true
        })()`)
        await clickMiddle('window.__opener')
        assert.ok(
          await browser.waitFor(`document.querySelector('dialog.ab-card')?.open`, 5000),
          'the title card did not open',
        )
        await cardInFull()
        for (const on of [false, true]) {
          await hoverClose(on)
          const { bars, fill, ratio } = await browser.evaluate<{
            bars: string
            fill: string
            ratio: number
          }>(contrast)
          if (ratio < 3)
            seen.push(
              `${scheme}, ${on ? 'hovered' : 'at rest'}: X in ${bars} on ${fill}, ${ratio}:1`,
            )
        }
        await hoverClose(false)
        await closeCardLeft()
      }
    } finally {
      await closeCardLeft()
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
        ],
      })
    }
    assert.deepEqual(seen, [], 'close buttons whose X doesn’t stand out at 3:1')
  })

  test('the chosen decade and vibe stand out, with a readable label and the theme’s focus ring', async () => {
    // The theme drops a chosen chip's yellow fill and its shadow, which left it looking like the
    // rest. It must still differ from an unchosen chip, its label must read at 4.5:1 or better
    // as the screen shows it, and its focus ring must take the theme's text color.
    const problems: string[] = []
    for (const scheme of ['light', 'dark']) {
      // This list replaces the one load() set, so reduced motion goes in again.
      await browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
      for (const [group, name] of [
        ['.ab-eras', 'decades'],
        ['.ab-moods', 'vibes'],
      ]) {
        // Focuses the chosen chip from the keyboard, so it shows its ring (:focus-visible): Tab
        // out of its group, then Shift+Tab back in.
        await browser.evaluate(
          `document.querySelector('${group}').scrollIntoView({ block: 'center' }); document.querySelector('${group} input:checked').focus(); true`,
        )
        await browser.press('Tab')
        await browser.press('Tab', true)
        // Read after two frames, once the page has painted in the theme's colors.
        const chip = await browser.evaluate<{
          focused: boolean
          same: boolean
          ring: string
          text: string
          label: { x: number; y: number; width: number; height: number }
        }>(`(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          // The theme's text color, as Chrome computes it.
          const probe = document.body.appendChild(document.createElement('i'))
          probe.style.color = 'CanvasText'
          const text = getComputedStyle(probe).color
          probe.remove()
          const [chosen, other] = ['input:checked', 'input:not(:checked)'].map((input) => document.querySelector('${group} ' + input + ' + span'))
          const look = (span) => { const c = getComputedStyle(span); return [c.backgroundColor, c.color, c.borderTopColor].join(' ') }
          const style = getComputedStyle(chosen)
          // The label's text box, in whole pixels from the top left of the page, rounded inward:
          // its edge pixels are partly the chip around it, and those would be measured instead
          // of a label hidden by a plate behind it.
          const range = document.createRange()
          range.selectNodeContents(chosen)
          const r = range.getBoundingClientRect()
          const x = Math.ceil(r.left + scrollX), y = Math.ceil(r.top + scrollY)
          return {
            focused: chosen.previousElementSibling.matches(':focus-visible'),
            same: look(chosen) === look(other),
            ring: style.outlineStyle === 'none' ? 'none' : style.outlineColor,
            text,
            label: { x, y, width: Math.floor(r.right + scrollX) - x, height: Math.floor(r.bottom + scrollY) - y },
          }
        })()`)
        const contrast = await pixelContrast(chip.label)
        const where = `${scheme} ${name}`
        if (!chip.focused) problems.push(`${where}: the chosen chip did not take keyboard focus`)
        if (chip.same) problems.push(`${where}: the chosen chip looks like the others`)
        if (chip.ring !== chip.text)
          problems.push(
            `${where}: its focus ring is ${chip.ring}, not the theme’s text color ${chip.text}`,
          )
        if (contrast < 4.5) problems.push(`${where}: its label reads ${contrast}:1`)
      }
    }
    await browser.evaluate('document.activeElement.blur(); scrollTo(0, 0); true')
    assert.deepEqual(
      problems,
      [],
      'chosen chips that a contrast theme hides, washes out or rings in the wrong color',
    )
  })

  test('the Reduce motion switch shows off, on and locked apart, with its knob in view', async () => {
    // A theme paints every background in its page color, and the switch's knob is one: it would
    // vanish into its track, and with it the side that says on or off. Off, the knob is in the
    // theme's text color, on the left. On, the chip takes the selection colors, as a chosen decade
    // does, and the knob, on the right, shows in them through a track of the selection's text
    // color. Locked on, as the device starts to ask for reduced motion, the chip takes the theme's
    // disabled color. As the screen shows each, its knob must stand out from its track at 3:1 or
    // better, and its label read at 4.5:1 or better.
    const problems: string[] = []
    const theme = (scheme: string, motion: string) =>
      browser.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: motion },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: scheme },
        ],
      })
    // The switch two frames after a change, scrolled to the middle of the screen: its chip's
    // colors and border, whether it is locked, and the theme's disabled color; then, as the screen
    // shows them, its label's contrast and its knob in a strip along the middle of its track (see
    // knobStrip).
    const read = async () => {
      const shown = await browser.evaluate<{
        locked: boolean
        look: string
        border: string
        text: string
        gray: string
        label: { x: number; y: number; width: number; height: number }
        track: { x: number; y: number; width: number; height: number }
      }>(`(async () => {
        const input = ${motionSwitch}, chip = input.nextElementSibling
        chip.scrollIntoView({ block: 'center' })
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const probe = document.body.appendChild(document.createElement('i'))
        probe.style.color = 'GrayText'
        const gray = getComputedStyle(probe).color
        probe.remove()
        const style = getComputedStyle(chip)
        const range = document.createRange()
        range.selectNodeContents(chip)
        const t = range.getBoundingClientRect()
        const x = Math.ceil(t.left + scrollX), y = Math.ceil(t.top + scrollY)
        return {
          locked: input.getAttribute('aria-disabled') === 'true',
          look: [style.backgroundColor, style.color, style.borderTopColor].join(' '),
          border: style.borderTopStyle,
          text: style.color,
          gray,
          label: { x, y, width: Math.floor(t.right + scrollX) - x, height: Math.floor(t.bottom + scrollY) - y },
          track: ${knobStrip},
        }
      })()`)
      const knob = knobIn(await screenPixels(shown.track))
      return { ...shown, knob, label: await pixelContrast(shown.label) }
    }
    try {
      assert.ok(await hasSwitch(), 'the footer has no Reduce motion switch')
      for (const scheme of ['light', 'dark']) {
        await theme(scheme, 'no-preference')
        const off = await read()
        // The device starts to ask, with the site's setting still off: locked on all the same.
        await theme(scheme, 'reduce')
        await browser.waitFor(`${motionSwitch}.getAttribute('aria-disabled') === 'true'`, 5000)
        const locked = await read()
        await theme(scheme, 'no-preference')
        await browser.waitFor(`!${motionSwitch}.hasAttribute('aria-disabled')`, 5000)
        await clickSwitch()
        const on = await read()
        await clickSwitch()
        await browser.animationsDone()
        if (off.locked) problems.push(`${scheme}: the switch stayed locked with motion allowed`)
        if (off.look === on.look) problems.push(`${scheme}: on looks like off (${on.look})`)
        if (!locked.locked) problems.push(`${scheme}: the switch did not lock as the device asked`)
        else if (locked.text !== locked.gray || locked.border !== 'dashed')
          problems.push(
            `${scheme} locked: its label is ${locked.text} and its border ${locked.border}, not the theme’s disabled color ${locked.gray}, dashed`,
          )
        for (const [state, { knob, label }, side] of [
          ['off', off, 'left'],
          ['on', on, 'right'],
          ['locked', locked, 'right'],
        ] as const) {
          if (knob.contrast < 3)
            problems.push(
              `${scheme} ${state}: its knob stands out from its track at ${knob.contrast}:1`,
            )
          else if (knob.side !== side)
            problems.push(`${scheme} ${state}: its knob is on the ${knob.side}, not the ${side}`)
          if (label < 4.5) problems.push(`${scheme} ${state}: its label reads ${label}:1`)
        }
      }
    } finally {
      await browser.evaluate(`localStorage.removeItem('anibeam:motion'); true`)
    }
    assert.deepEqual(
      problems,
      [],
      'switch states that a contrast theme hides or shows alike, as on and off and locked on, in its light and dark palettes',
    )
  })
})
