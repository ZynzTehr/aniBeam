// The page by keyboard alone: where focus goes, and that it always shows. Spec §5 and WCAG 2.4.7
// (focus visible), 2.4.11 (focus not obscured) and 2.1.1 (keyboard).
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
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

// What has focus, and how much of it the sticky header hides: a chip's radio button is see-through,
// so for a chip it is its pill that shows. Only where the header is drawn on top does it hide
// anything: its own links are in it, and the skip links are drawn over it.
const FOCUSED = `(() => {
  const focused = document.activeElement
  if (!focused || focused === document.body) return { name: 'nothing', hidden: 0 }
  const shown = (focused.matches('.ab-chip input') ? focused.nextElementSibling : focused).getBoundingClientRect()
  const header = document.querySelector('.ab-top')
  const under = header.getBoundingClientRect().bottom
  const covering = shown.top < under && header.contains(document.elementFromPoint(shown.left + shown.width / 2, Math.max(shown.top, 0) + 1))
  const sticky = getComputedStyle(header).position === 'sticky' && !header.contains(focused) && covering
  const name = (focused.getAttribute('aria-label') || focused.textContent || focused.value || focused.placeholder || focused.tagName)
    .replace(/\\s+/g, ' ').trim().slice(0, 40)
  return { name, hidden: sticky ? Math.round(Math.max(0, Math.min(shown.bottom, under) - Math.max(shown.top, 0))) : 0 }
})()`

test('from 900px, focus never lands under the sticky header, going back with Shift+Tab or by the skip link', async () => {
  const seen: string[] = []
  // At 960px with widened text spacing, the header takes a second row, 135px: letters 0.2em apart,
  // more than WCAG 1.4.12's least (0.12em), at which it keeps one row since My List became a link.
  // It waits until the header has settled and published its height (--top-h): the search bubble
  // measures its wider text a frame later, which wraps the header a frame after, and --top-h
  // follows a frame after that. So the two must agree for 5 frames running.
  const SPACING = `(async () => {
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = '* { line-height: 1.5 !important; letter-spacing: 0.2em !important; word-spacing: 0.16em !important } p { margin-bottom: 2em !important }'
    const header = document.querySelector('.ab-top')
    for (let agreed = 0; agreed < 5; ) {
      await new Promise(requestAnimationFrame)
      const published = getComputedStyle(document.documentElement).getPropertyValue('--top-h')
      agreed = published === header.offsetHeight + 'px' ? agreed + 1 : 0
    }
    return true
  })()`
  for (const { spacing, ...screen } of [
    { width: 1440, height: 900, spacing: false },
    { width: 1024, height: 768, spacing: false },
    { width: 960, height: 900, spacing: true },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    if (spacing) await browser.evaluate(SPACING)
    assert.ok(await browser.titlesShown())
    // From the footer's Reduce motion switch, back through every stop to the top of the page.
    await browser.press('Tab')
    await browser.evaluate(`document.getElementById('reduce-motion').focus(); true`)
    for (let stop = 0; stop < 80; stop++) {
      await browser.press('Tab', true)
      const { name, hidden } = await browser.evaluate<{ name: string; hidden: number }>(FOCUSED)
      if (hidden > 0)
        seen.push(`${screen.width}px: Shift+Tab to "${name}", ${hidden}px under the header`)
      if (name === 'Skip to content' || name === 'nothing') break
    }
    // The skip link to the content, from the top of the page, once the titles have landed (as
    // they land, what is on screen keeps its place, which can move the page): the content starts
    // below the header.
    await browser.load({ ...screen, reduceMotion: true })
    if (spacing) await browser.evaluate(SPACING)
    assert.ok(await browser.titlesShown())
    await browser.press('Tab')
    await browser.press('Enter')
    const main = await browser.evaluate<number>(
      `Math.round(document.querySelector('.ab-top').getBoundingClientRect().bottom - document.getElementById('main').getBoundingClientRect().top)`,
    )
    if (main > 0)
      seen.push(
        `${screen.width}px: the skip link leaves the content's top ${main}px under the header`,
      )
    // And the header's own controls take focus where the visitor is: as scroll padding for the
    // whole page, the header's height had Chrome scroll to the top as its search box took focus.
    const moved = await browser.evaluate<number>(`(() => {
      scrollTo(0, 1500)
      document.querySelector('.ab-search textarea').focus()
      return Math.round(scrollY) - 1500
    })()`)
    if (moved) seen.push(`${screen.width}px: focusing the search box moved the page ${moved}px`)
  }
  assert.deepEqual(seen, [], 'focus under the sticky header')
})

test('a title card taller than the screen shows its focus ring, inside its edge, as Tab reaches it', async () => {
  // Taller than the screen, the card scrolls, and Chrome makes it a Tab stop of its own. Its ring
  // must show on the screen: inside its edge, which is the screen's, on the title's color.
  const seen: string[] = []
  for (const screen of [
    { width: 390, height: 844, phone: true },
    { width: 1280, height: 600 },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    await browser.evaluate(`document.querySelector('.ab-grid .ab-link').focus(); true`)
    await browser.press('Enter')
    assert.ok(await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000))
    await browser.animationsDone()
    let card = false
    for (let stop = 0; stop < 10 && !card; stop++) {
      await browser.press('Tab')
      card = await browser.evaluate<boolean>(`document.activeElement?.matches('dialog.ab-card')`)
    }
    if (!card) {
      seen.push(`${screen.width}px: Tab never reached the card itself`)
      await browser.press('Escape')
      continue
    }
    // The screen's four edges, which are the card's, as the screen shows them, with its ring, then
    // with focus taken off it and all else as it was (focus moved on to Close would scroll the
    // card, and the speed lines): at each point along each edge, the ring must change some of the
    // 8px in from it at 3:1 or better against what is there without it (the title's color, the
    // speed lines' white, the card's ink). The clip is in the page's pixels, so it adds the page's
    // scroll, and on a phone the pixels are twice as many each way.
    const edges = async () => {
      const { x, y } = await browser.evaluate<{ x: number; y: number }>(
        `({ x: scrollX, y: scrollY })`,
      )
      const { width, height } = screen
      return {
        left: await screenPixels({ x, y, width: 8, height }),
        right: await screenPixels({ x: x + width - 8, y, width: 8, height }),
        top: await screenPixels({ x, y, width, height: 8 }),
        bottom: await screenPixels({ x, y: y + height - 8, width, height: 8 }),
      }
    }
    // Scrolled by the keyboard, as it is a Tab stop for that: the ring stays on the screen's edges.
    await browser.press('End')
    await browser.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
    const focused = await edges()
    const ring = await browser.evaluate<string>(
      `(() => { const style = getComputedStyle(document.activeElement); return style.outlineStyle + ' ' + style.outlineWidth + ' ' + style.outlineColor + ', offset ' + style.outlineOffset })()`,
    )
    await browser.evaluate(`document.activeElement.blur(); true`)
    const unfocused = await edges()
    // Scrolled to its foot, the top edge cuts through whatever the card holds there: where ink
    // text meets it (as the title's tall letters did, once the details made the card longer), the
    // ring's ink lies on ink and its white line on white paper, and changes nothing at those
    // points, whatever the ring. So the top edge is read scrolled back to the card's head
    // (Home), where the screen's edge is the title's color above the sheet. At the foot it must
    // still show along most of the top edge, all but where the letters meet it.
    const foot = { on: focused.top, off: unfocused.top }
    await browser.evaluate(`document.querySelector('dialog.ab-card').focus(); true`)
    await browser.press('Home')
    await browser.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
    focused.top = (await edges()).top
    await browser.evaluate(`document.activeElement.blur(); true`)
    unfocused.top = (await edges()).top
    const at = ({ width, rgb }: { width: number; rgb: number[] }, x: number, y: number) =>
      rgb.slice((y * width + x) * 3, (y * width + x) * 3 + 3)
    // The share of the points along an edge where the ring changes any pixel across its depth.
    type Shot = typeof focused.top
    const share = (on: Shot, off: Shot, upright: boolean) => {
      const rows = on.rgb.length / 3 / on.width
      const [length, depth] = upright ? [rows, on.width] : [on.width, rows]
      const points = Array.from({ length }, (_, i) =>
        Array.from({ length: depth }, (_, d) => (upright ? [d, i] : [i, d])).some(
          ([x, y]) => contrast(at(on, x, y), at(off, x, y)) >= 3,
        ),
      )
      return points.filter(Boolean).length / length
    }
    const along = (side: keyof typeof focused) =>
      share(focused[side], unfocused[side], side === 'left' || side === 'right')
    const short = (['left', 'right', 'top', 'bottom'] as const)
      .map((side) => [side, along(side)] as const)
      .filter(([, share]) => share < 0.95)
    if (short.length)
      seen.push(
        `${screen.width}px: ring ${ring}, at 3:1 on ${short.map(([side, share]) => `${Math.round(share * 100)}% of the ${side} edge`).join(', ')}`,
      )
    const atFoot = share(foot.on, foot.off, false)
    if (atFoot < 0.75)
      seen.push(
        `${screen.width}px: ring ${ring}, at 3:1 on ${Math.round(atFoot * 100)}% of the top edge, scrolled to the foot`,
      )
    await browser.press('Escape')
  }
  assert.deepEqual(seen, [], 'the focused card shows no ring on the screen')
})

test('a chip Tab reaches at the foot of the screen shows its whole pill and focus ring', async () => {
  // A chip's radio button is see-through, and Tab scrolls only if what takes focus isn't on the
  // screen yet (a script's focus() centres it instead): were that the button's own 13px box, its
  // pill, and the ring 7px beyond, could hang off the screen's foot while it shows. So for each
  // group, focus goes to the stop before its chosen chip, the chip's pill is put 20px above the
  // screen's foot, the rest below, and Tab moves on to it.
  const seen: string[] = []
  for (const screen of [
    { width: 1440, height: 900 },
    { width: 390, height: 844, phone: true },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    for (const group of ['.ab-eras']) {
      const chip = `document.querySelector('${group} input:checked')`
      await browser.evaluate(`${chip}.focus({ preventScroll: true }); true`)
      await browser.press('Tab', true)
      await browser.evaluate(`(() => {
        const label = ${chip}.nextElementSibling
        scrollTo({ top: label.getBoundingClientRect().top + scrollY - innerHeight + 20, behavior: 'instant' })
        return true
      })()`)
      await browser.press('Tab')
      const shown = await browser.evaluate<string>(`(() => {
        const input = ${chip}, label = input.nextElementSibling
        if (document.activeElement !== input) return 'Tab missed the chip'
        const pill = label.getBoundingClientRect(), ring = 7
        const cut = [pill.top - ring < 0 && 'the top', pill.bottom + ring > innerHeight && 'the bottom'].filter(Boolean)
        return label.textContent + (cut.length ? ', cut off at ' + cut.join(' and ') + ' (pill ' + Math.round(pill.top) + ' to ' + Math.round(pill.bottom) + 'px, the screen ' + innerHeight + 'px)' : '')
      })()`)
      if (shown.includes(',') || shown.startsWith('Tab missed'))
        seen.push(`${screen.width}px: ${shown}`)
    }
  }
  assert.deepEqual(seen, [], 'chips whose pill or ring Tab leaves off the screen')
})

test("each of the header's section links hands focus to its section's heading, and Tab goes on into it", async () => {
  // Following a link moves the page, and focus moves only to something that can take it: the
  // sections' headings can, so that a keyboard user goes on from there.
  const seen: string[] = []
  for (const screen of [
    { width: 1440, height: 900 },
    { width: 390, height: 844, phone: true },
  ]) {
    await browser.load({ ...screen, reduceMotion: true })
    assert.ok(await browser.titlesShown())
    // On a phone the links are in the menu, which the menu button opens.
    const phone = screen.width < 900
    for (const label of ['Trending', 'Pull', 'Decades']) {
      // From the top of the page; on a wide screen, from its end, where the intro's buttons have
      // docked and the header's links show.
      await browser.evaluate(
        `scrollTo({ top: ${screen.width >= 900 ? 'document.documentElement.scrollHeight' : 0}, behavior: 'instant' }); true`,
      )
      await browser.evaluate(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      )
      if (phone) {
        await browser.evaluate(`document.querySelector('.ab-burger').focus(); true`)
        await browser.press('Enter')
      }
      await browser.evaluate(`(() => {
        ;[...document.querySelectorAll('${phone ? '.ab-drawer nav a' : '.ab-nav a'}')].find((link) => link.firstChild.textContent === '${label}').focus()
        return true
      })()`)
      await browser.press('Enter')
      const where = `(() => {
        const focused = document.activeElement
        const section = focused.closest('section')
        return (focused.matches('h1, h2') ? 'the heading "' + focused.firstChild.textContent.trim() + '"' : focused.tagName.toLowerCase() + ' "' + focused.textContent.trim().slice(0, 20) + '"') + (section ? ' in #' + (section.querySelector('h1[id], h2[id]')?.id ?? '?') : '')
      })()`
      const landed = await browser.evaluate<string>(where)
      await browser.press('Tab')
      const next = await browser.evaluate<string>(where)
      const section = /in #([\w-]+)/.exec(landed)?.[1]
      if (!landed.startsWith('the heading') || !section || !next.endsWith(`in #${section}`))
        seen.push(`${screen.width}px, ${label}: focus on ${landed}, then Tab to ${next}`)
    }
  }
  assert.deepEqual(seen, [], "header links that don't hand focus to their section's heading")
})

// Each Tab stop of the page, in order: a run of stops alike is one entry, with its count. Title
// panels go by their section, as their titles come from AniList, and the machine's top matches by
// their heading.
const STOPS = [
  'Skip to content',
  'Skip to Reduce motion',
  'AniBeam',
  'Trending',
  'Pull',
  'Decades',
  'My List',
  'Search titles',
  'See what’s trending',
  'Pull a random title',
  'Browse by decade',
  'My List',
  'a title in Trending now ×9',
  'Energy',
  'Tone',
  'Complexity',
  'Pull!',
  'a title in Most popular in the 1990s ×3',
  'Decade: 1990s',
  'a title in Browse by decade ×20',
  'Reduce motion',
]

// The header's section links wait hidden while the intro's buttons are on the page (see
// lib/sectionNav.ts), so a walk from the top meets only the buttons. On a wide screen, walking
// back from the end, the buttons have docked in the header, so it meets the header's links
// instead. Both sets end in My List, so the header's are taken out by their place, after AniBeam.
const HEADER_STOPS = STOPS.indexOf('AniBeam') + 1
const STOPS_TOP = STOPS.toSpliced(HEADER_STOPS, 4)
// On a phone neither is drawn: the menu button opens the links, and the walk goes on to the page.
const STOPS_PHONE = [
  ...STOPS.slice(0, 2),
  'Menu',
  ...STOPS_TOP.filter(
    (stop) =>
      !['See what’s trending', 'Pull a random title', 'Browse by decade', 'My List'].includes(stop),
  ).slice(2),
]
const BACK_WIDE = [
  'Reduce motion',
  'a title in Browse by decade ×20',
  'Decade: 1990s',
  'a title in Most popular in the 1990s ×3',
  'Pull!',
  'Complexity',
  'Tone',
  'Energy',
  'a title in Trending now ×9',
  'Search titles',
  'My List',
  'Decades',
  'Pull',
  'Trending',
  'AniBeam',
  'Skip to Reduce motion',
  'Skip to content',
]

// The stop that has focus, and what is wrong with how it shows, read as Tab reaches it: it must be
// whole, its ring too, on the screen, clear of the sticky header and of anything that clips it,
// and not see-through. A chip's or the switch's input is see-through, so for those it is the pill
// that shows; the search box's focus shows as its bubble's lift, so for it, the bubble, which on
// a phone clips the box as it grows. A ring reaches its outline's width and offset beyond what it
// rings, or 7px (the rings drawn as a frame, such as a heading's).
const STOP = `(() => {
  const focused = document.activeElement
  if (!focused || focused === document.body) return null
  const text = (el) => {
    const copy = el.cloneNode(true)
    copy.querySelectorAll('[aria-hidden="true"], rt').forEach((unread) => unread.remove())
    return copy.textContent.replace(/\\s+/g, ' ').trim()
  }
  // A title card taller than the screen, which scrolls, is a stop of its own: its ring is a frame
  // inside the screen's edge, which its own check looks at (a title card taller than the screen).
  if (focused.matches('dialog')) return { name: focused.matches('.ab-trailer') ? 'the trailer' : 'the card', problems: [] }
  const name = focused.matches('.ab-grid .ab-link, .ab-strip-panel, .ab-match')
    ? 'a title in ' + text((focused.closest('.ab-matches') ?? focused.closest('section')).querySelector('h1, h2, h3'))
    : focused.matches('input[type="range"]')
      ? text(focused.labels[0])
      : focused.matches('fieldset input')
      ? text(focused.closest('fieldset').querySelector('legend')) + ': ' + text(focused.parentElement)
      : focused.getAttribute('aria-label') || (focused.matches('label > input') ? text(focused.parentElement) : text(focused) || focused.placeholder || focused.tagName.toLowerCase())
  const shown = focused.matches('label > input') ? focused.nextElementSibling : focused.closest('.ab-bubble-field') ?? focused
  const style = getComputedStyle(shown)
  const reach = style.outlineStyle === 'none' ? 7 : parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
  const box = shown.getBoundingClientRect()
  const ring = { top: box.top - reach, right: box.right + reach, bottom: box.bottom + reach, left: box.left - reach }
  const problems = []
  let opacity = 1
  for (let el = shown; el; el = el.parentElement) opacity *= parseFloat(getComputedStyle(el).opacity)
  if (opacity < 0.99) problems.push('see-through (opacity ' + opacity.toFixed(2) + ')')
  if (style.visibility !== 'visible') problems.push('hidden')
  const cut = (by, edges) => {
    const sides = ['top', 'left'].filter((side) => ring[side] < edges[side] - 0.5)
      .concat(['bottom', 'right'].filter((side) => ring[side] > edges[side] + 0.5))
    if (sides.length) problems.push('ring cut off at the ' + sides.join(' and ') + ' by ' + by)
  }
  cut('the screen', { top: 0, left: 0, bottom: innerHeight, right: innerWidth })
  // The sticky header covers what reaches under it, unless that is drawn over it, as the skip links
  // are, and a modal dialog's parts are: what is at the stop's own top edge tells.
  const header = document.querySelector('.ab-top')
  const under = header.getBoundingClientRect().bottom
  const top = Math.max(box.top, 0) + 1
  const hit = top < under && document.elementFromPoint((box.left + box.right) / 2, top)
  const over = hit && (focused.contains(hit) || shown.contains(hit))
  if (getComputedStyle(header).position === 'sticky' && !header.contains(focused) && !focused.closest('dialog') && ring.top < under - 0.5 && !over)
    problems.push('ring under the header by ' + Math.round(under - Math.max(ring.top, 0)) + 'px')
  for (let el = shown.parentElement; el && el !== document.body; el = el.parentElement) {
    const clips = getComputedStyle(el)
    if (clips.overflowX === 'visible' && clips.overflowY === 'visible') continue
    const edges = el.getBoundingClientRect()
    cut('.' + el.classList[0], {
      top: clips.overflowY === 'visible' ? -Infinity : edges.top + el.clientTop,
      left: clips.overflowX === 'visible' ? -Infinity : edges.left + el.clientLeft,
      bottom: clips.overflowY === 'visible' ? Infinity : edges.top + el.clientTop + el.clientHeight,
      right: clips.overflowX === 'visible' ? Infinity : edges.left + el.clientLeft + el.clientWidth,
    })
  }
  return { name, problems }
})()`

test('Enter on My List’s link, the intro’s, the header’s or the phone menu’s, hands focus to My List’s heading, with its ring, before its file has loaded and after', async () => {
  // The intro's goes with the intro as it is followed, so focus would fall to the page's start,
  // with nothing said: My List's heading takes it, as a section's does after its link.
  const where = `(() => {
    const focused = document.activeElement
    return {
      path: location.pathname,
      focus: focused.id || focused.tagName,
      ring: focused.matches(':focus-visible'),
      jump: focused.dataset.jump ?? 'unmarked',
      top: scrollY,
    }
  })()`
  const arrived = { path: '/list', focus: 'ab-list', ring: true, jump: 'unmarked', top: 0 }
  await browser.forget()
  await browser.load({ width: 1440, height: 900, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  // With nothing saved, My List's page loads only as it is opened (see features/list/page.ts).
  const pageLoaded = `performance.getEntriesByType('resource').some((entry) => entry.name.includes('ListPage'))`
  assert.equal(await browser.evaluate(pageLoaded), false, 'My List’s file loaded before it opened')
  for (const [i, [link, label]] of [
    ['.ab-intro-actions a[href="/list"]', 'the intro’s, before My List’s file has loaded'],
    ['.ab-intro-actions a[href="/list"]', 'the intro’s, once it has'],
    ['.ab-nav a[href="/list"]', 'the header’s'],
  ].entries()) {
    // Back to Discover from My List, after the first.
    if (i > 0) {
      await browser.evaluate(`history.back(); true`)
      assert.ok(await browser.waitFor(`document.querySelector('.ab-intro-actions')`, 5000), label)
    }
    // The header's shows once the intro's buttons have docked, at the page's end, a frame or so
    // after the scroll there: hidden, it can't take focus.
    await browser.evaluate(
      `scrollTo({ top: ${link.startsWith('.ab-nav') ? 'document.documentElement.scrollHeight' : 0}, behavior: 'instant' }); true`,
    )
    assert.ok(
      await browser.waitFor(
        `getComputedStyle(document.querySelector('${link}')).visibility === 'visible'`,
        5000,
      ),
      `${label}: not shown`,
    )
    await browser.evaluate(`document.querySelector('${link}').focus(); true`)
    await browser.evaluate(NEXT_FRAME)
    assert.ok(
      await browser.evaluate(`document.activeElement === document.querySelector('${link}')`),
      `${label}: took no focus`,
    )
    await browser.press('Enter')
    await browser.waitFor(`document.activeElement.id === 'ab-list'`, 5000)
    assert.deepEqual(await browser.evaluate(where), arrived, label)
  }
  // On a phone, the menu's, which shuts the menu as it goes.
  await browser.load({ width: 390, height: 844, phone: true, reduceMotion: true })
  assert.ok(await browser.titlesShown())
  await browser.evaluate(`document.querySelector('.ab-burger').focus(); true`)
  await browser.press('Enter')
  assert.ok(await browser.waitFor(`document.querySelector('.ab-drawer').open`, 5000), 'no menu')
  await browser.evaluate(`document.querySelector('.ab-drawer a[href="/list"]').focus(); true`)
  await browser.press('Enter')
  await browser.waitFor(`document.activeElement.id === 'ab-list'`, 5000)
  await browser.evaluate(SETTLED)
  assert.deepEqual(await browser.evaluate(where), arrived, 'the menu’s')
  assert.equal(await browser.evaluate(`document.querySelector('.ab-drawer').open`), false)
})

// Waits for the page's time-based animations and transitions running now to finish, then two
// frames more: those due to end within 3 s, so that one stuck or far behind shows as a problem
// instead of being waited out.
const SETTLED = `(async () => {
  const due = document.getAnimations().filter((a) => a.timeline === document.timeline && a.playState === 'running' && a.effect.getComputedTiming().endTime - a.currentTime <= 3000)
  await Promise.all(due.map((a) => a.finished.catch(() => {})))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return true
})()`

const NEXT_FRAME =
  'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'

test('Tab walks every stop of the page in order and Shift+Tab walks them back, each whole on the screen with its focus showing', async () => {
  // On a desktop with motion, after the first screen's entrances, and on a phone with reduced
  // motion. Forward, each stop's focus must also show by WCAG's measure for a focus indicator
  // (2.4.13): the stop, focused against unfocused, changes at 3:1 or better over at least the area
  // of a 2px line around it. Unfocused means blurred, all else as it was, then focused again.
  const seen: Record<string, unknown> = {}
  for (const screen of [
    { width: 1440, height: 900, reduceMotion: false },
    { width: 390, height: 844, phone: true, reduceMotion: true },
  ]) {
    await browser.load(screen)
    assert.ok(await browser.titlesShown())
    await browser.evaluate(SETTLED)
    seen[`${screen.width}px`] = await walkStops()
  }
  assert.deepEqual(seen, {
    '1440px': { stops: STOPS_TOP, back: BACK_WIDE, problems: [] },
    '390px': { stops: STOPS_PHONE, back: 'the same, reversed', problems: [] },
  })
})

/**
 * Tabs from the top of the page to its end, then Shift+Tabs back to the top, and says what it met:
 * each stop's name in order (see runs), the walk back if it differs from the walk forward reversed,
 * and what is wrong with how a stop showed (see STOP), forward with WCAG's measure for a focus
 * indicator too (see focusShows).
 */
async function walkStops() {
  const problems: string[] = []
  const walk = async (back: boolean) => {
    const names: string[] = []
    for (let stop = 0; stop < 80; stop++) {
      await browser.press('Tab', back)
      await browser.evaluate(NEXT_FRAME)
      const found = await browser.evaluate<{ name: string; problems: string[] } | null>(STOP)
      if (!found) return names
      names.push(found.name)
      const to = `${back ? 'Shift+Tab' : 'Tab'} to stop ${back ? 'from the end ' : ''}${stop + 1}, "${found.name}"`
      for (const problem of found.problems) problems.push(`${to}: ${problem}`)
      if (!back) {
        const shows = await focusShows()
        if (shows < 1)
          problems.push(`${to}: its focus changes ${Math.round(shows * 100)}% of the area it must`)
      }
    }
    return names
  }
  const forward = await walk(false)
  const back = await walk(true)
  return {
    stops: runs(forward),
    back: back.join() === forward.toReversed().join() ? 'the same, reversed' : runs(back),
    problems,
  }
}

test('on My List, Tab walks every stop in order and Shift+Tab walks them back, each whole on the screen with its focus showing, and the Undo in a cover’s place is a stop of its own', async () => {
  // The 12 titles of the list-12 recording, as AniList answered them (see LISTS in recordings.ts):
  // Saved 8, one with the heart, and Want to try 4, two with it. As the page walk, on a desktop
  // with motion and on a phone with reduced motion. The header's section links show on My List,
  // which has no intro to hold its buttons (see lib/sectionNav.ts).
  const list = Object.fromEntries(
    [154587, 21, 1, 30, 572, 195516, 47, 164, 97940, 339, 437, 523].map((id, i) => [
      id,
      {
        status: [154587, 21, 572, 97940].includes(id) ? 'WANT' : 'SAVED',
        favorite: [154587, 30, 572].includes(id),
        updatedAt: Date.now() - i,
      },
    ]),
  )
  const seen: Record<string, unknown> = {}
  try {
    for (const screen of [
      { width: 1440, height: 900, reduceMotion: false },
      { width: 390, height: 844, phone: true, reduceMotion: true },
    ]) {
      // Loaded with nothing saved, which asks AniList for nothing, to write the list on the site's
      // own page for the load after.
      const url = new URL('/list', BASE_URL).href
      await browser.forget()
      await browser.load({ ...screen, url })
      await browser.evaluate(
        `localStorage.setItem('anibeam:list:v1', ${JSON.stringify(JSON.stringify(list))}), true`,
      )
      await browser.load({ ...screen, url })
      assert.ok(
        await browser.waitFor(
          `document.querySelectorAll('#main .ab-strip-panel[href]').length === 8`,
          10_000,
        ),
        'My List didn’t show its 8 Saved covers',
      )
      await browser.evaluate(SETTLED)
      const page = await walkStops()
      // A title taken off in its card: its Undo, in the cover's place, takes focus as the card
      // closes, Tab goes on to the next cover, and Shift+Tab from the Undo to the one before it.
      const cover = `document.querySelector('#main .ab-strip-panel[href="/anime/30"]')`
      await browser.evaluate(`${cover}.focus(); ${cover}.click(); true`)
      assert.ok(
        await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5000),
        'no card opened',
      )
      await browser.evaluate(
        `[...document.querySelectorAll('dialog.ab-card[open] [role="group"] button')].find((button) => button.textContent.trim() === 'Save').click(), true`,
      )
      await browser.press('Escape')
      assert.ok(await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5000))
      await browser.evaluate(SETTLED)
      // The stop focus is on, then after Tab, Shift+Tab and Shift+Tab again.
      const undo = []
      for (const back of [false, true, true, null]) {
        const found = await browser.evaluate<{ name: string; problems: string[] } | null>(STOP)
        undo.push(found ? [found.name, ...found.problems].join(': ') : 'nothing')
        if (back === null) break
        await browser.press('Tab', back)
        await browser.evaluate(NEXT_FRAME)
      }
      seen[`${screen.width}px`] = { ...page, undo }
    }
  } finally {
    await browser.evaluate(`localStorage.removeItem('anibeam:list:v1'), true`)
  }
  const stops = (header: string[]) => [
    'Skip to content',
    'Skip to Reduce motion',
    ...header,
    'Search titles',
    'Saved 8',
    'Want to try 4',
    'Favorites only',
    'a title in My List ×8',
    'Reduce motion',
  ]
  assert.deepEqual(seen, {
    '1440px': {
      stops: stops(['AniBeam', 'Trending', 'Pull', 'Decades', 'My List']),
      back: 'the same, reversed',
      problems: [],
      undo: ['Undo', 'a title in My List', 'Undo', 'a title in My List'],
    },
    '390px': {
      stops: stops(['Menu', 'AniBeam']),
      back: 'the same, reversed',
      problems: [],
      undo: ['Undo', 'a title in My List', 'Undo', 'a title in My List'],
    },
  })
})

test("Tab walks a title's card round from its Close and Shift+Tab walks it back, through its trailer's dialog and out, each stop whole on the screen with its focus showing", async () => {
  // Frieren at its address (/anime/154587), whose card has a trailer, a synopsis over five lines
  // and spoiler tags, so every button the card can have, its My List row's three first: on a
  // desktop with motion, once the card has landed, and on a phone with reduced motion. Each stop
  // is read as the page walk reads one, forward with WCAG's measure for a focus indicator too.
  // Past its last control Chrome takes focus to its own (the browser), then to the card itself,
  // which scrolls, and on to Close. Read more, pressed, opens the synopsis above it, and as Show
  // less it must still show, as must Read more again. Watch trailer opens the trailer on its
  // Close; Tab goes on to Open on YouTube and back; Esc closes it, with focus back on Watch
  // trailer. Then, as AniList fails to give the title a newer answer than the saved one, the walk
  // again, with the status line's Try again in it.
  const seen: Record<string, unknown> = {}
  const name = async () =>
    (await browser.evaluate<{ name: string } | null>(STOP))?.name ?? 'the browser'
  for (const screen of [
    { width: 1440, height: 900, reduceMotion: false },
    { width: 390, height: 844, phone: true, reduceMotion: true },
  ]) {
    const url = new URL('/anime/154587', BASE_URL).href
    const problems: string[] = []
    // The stop that has focus, two frames on, as Tab reaches it; its problems noted.
    const stop = async (to: string, measure = true) => {
      await browser.evaluate(NEXT_FRAME)
      const found = await browser.evaluate<{ name: string; problems: string[] } | null>(STOP)
      if (!found) return 'the browser'
      for (const problem of found.problems) problems.push(`${to} "${found.name}": ${problem}`)
      if (measure && !found.name.startsWith('the ')) {
        const shows = await focusShows()
        if (shows < 1)
          problems.push(
            `${to} "${found.name}": its focus changes ${Math.round(shows * 100)}% of the area it must`,
          )
      }
      return found.name
    }
    // From Close round the card to Close again, forward or back.
    const round = async (back: boolean, what: string) => {
      const names: string[] = []
      for (let press = 0; press < 12 && names.at(-1) !== 'Close title card'; press++) {
        await browser.press('Tab', back)
        names.push(await stop(`${what}, ${back ? 'Shift+Tab' : 'Tab'} ${press + 1} to`, !back))
      }
      return names
    }
    const toClose = `document.querySelector('dialog.ab-card[open] .ab-close').focus(); true`
    const tabTo = async (to: string) => {
      await browser.evaluate(toClose)
      for (let press = 0; press < 12 && (await name()) !== to; press++) await browser.press('Tab')
    }

    await browser.forget()
    await browser.load({ ...screen, url })
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`, 10_000),
      `${screen.width}px: Frieren's card didn't open`,
    )
    await browser.animationsDone()
    await browser.evaluate(SETTLED)
    const first = await name()
    const forward = await round(false, 'the card')
    const back = await round(true, 'the card')
    const reversed = ['the card', ...forward.slice(0, -2).toReversed(), 'Close title card']

    // Read more, then Show less.
    await tabTo('Read more')
    const more: string[] = []
    for (const press of [1, 2]) {
      await browser.press('Enter')
      more.push(await stop(`Read more, Enter ${press} on`, false))
    }

    // Into the trailer and back out.
    await tabTo('Watch trailer')
    await browser.press('Enter')
    assert.ok(
      await browser.waitFor(`document.querySelector('dialog.ab-trailer[open]')`, 5000),
      `${screen.width}px: Watch trailer opened no trailer`,
    )
    await browser.animationsDone()
    const trailer = [await stop('the trailer, opened on')]
    await browser.press('Tab')
    trailer.push(await stop('the trailer, Tab to'))
    await browser.press('Tab', true)
    trailer.push(await stop('the trailer, Shift+Tab to'))
    await browser.press('Escape')
    assert.ok(
      await browser.waitFor(`!document.querySelector('dialog.ab-trailer')`, 5000),
      `${screen.width}px: Esc left the trailer open`,
    )
    const out = await stop('Esc out of the trailer to')

    // As AniList fails to give Frieren anew: its answer saved as an airing title's, aged past the
    // 6 hours an airing title's is kept, then a 400 for it, which the app doesn't try again, so the
    // status line offers Try again at once.
    await browser.rewriteAniList(({ request, status, body }) => {
      if (request.variables.id !== 154587) return null
      body.data.Media.status = 'RELEASING'
      return { status, body }
    })
    try {
      await browser.forget()
      await browser.load({ ...screen, url })
      assert.ok(await browser.waitFor(`document.querySelector('dialog.ab-card.is-landed')`))
      // The cache is saved at most once a second.
      await sleep(1500)
    } finally {
      await browser.rewriteAniList(null)
    }
    assert.ok(
      await browser.evaluate<boolean>(`(() => {
        const copy = JSON.parse(localStorage.getItem('anibeam:cache') ?? 'null')
        const title = copy?.clientState.queries.find((query) => query.queryKey[2]?.id === 154587)
        if (!title) return false
        title.state.dataUpdatedAt -= 7 * 60 * 60_000
        localStorage.setItem('anibeam:cache', JSON.stringify(copy))
        return true
      })()`),
      `${screen.width}px: Frieren's answer was never saved`,
    )
    await browser.rewriteAniList(({ request }) =>
      request.variables.id === 154587
        ? { status: 400, body: { data: null, errors: [{ message: 'Bad Request.', status: 400 }] } }
        : null,
    )
    let failing: string[] = []
    try {
      await browser.load({ ...screen, url })
      assert.ok(
        await browser.waitFor(
          `document.querySelector('dialog.ab-card.is-landed .ab-card-status.is-shown .ab-retry')`,
          10_000,
        ),
        `${screen.width}px: no Try again in the card's status line`,
      )
      await browser.animationsDone()
      await browser.evaluate(SETTLED)
      await browser.evaluate(toClose)
      failing = await round(false, 'with Try again, the card')
    } finally {
      await browser.rewriteAniList(null)
    }

    seen[`${screen.width}px`] = {
      first,
      round: forward,
      back: back.join() === reversed.join() ? 'the same, reversed' : back,
      more,
      trailer,
      out,
      failing,
      problems,
    }
  }
  const expected = {
    first: 'Close title card',
    round: [
      'Save',
      'Want to try',
      'Favorite',
      'Open on AniList',
      'Watch trailer',
      'Read more',
      'Show spoiler tags',
      'the browser',
      'the card',
      'Close title card',
    ],
    back: 'the same, reversed',
    more: ['Show less', 'Read more'],
    trailer: ['Close', 'Open on YouTube', 'Close'],
    out: 'Watch trailer',
    failing: [
      'Save',
      'Want to try',
      'Favorite',
      'Open on AniList',
      'Watch trailer',
      'Read more',
      'Show spoiler tags',
      'Try again',
      'the browser',
      'the card',
      'Close title card',
    ],
    problems: [],
  }
  assert.deepEqual(seen, { '1440px': expected, '390px': expected })
})

test('by keyboard alone, Esc empties the search box, arrow keys, Home and End move a mood slider, arrow keys choose a decade, and Space pulls, opens a title card on its Close button and closes it', async () => {
  // On a desktop with motion and on a phone with reduced motion (see keyboardJourney).
  const seen: Record<string, unknown> = {}
  for (const screen of [
    { width: 1440, height: 900, reduceMotion: false },
    { width: 390, height: 844, phone: true, reduceMotion: true },
  ])
    seen[`${screen.width}px`] = await keyboardJourney(screen)
  const expected = {
    search: { box: '', results: false, focus: 'Search titles', then: 'See what’s trending' },
    energy: [
      'Energy: Cozy',
      'Energy: Very cozy',
      'Energy: Very cozy',
      'Energy: Very high-octane',
      'Energy: Very cozy',
      'Energy: Cozy',
      'Energy: No preference',
    ],
    lever: ['Tone', 'Complexity', 'Pull!'],
    pull: {
      focus: 'Again!',
      count: '1 pull this visit',
      heard: true,
      then: ['Open the title card for the pulled title', 'Open title card'],
    },
    card: { first: 'Close title card', round: 'round the card' },
    closed: 'Open title card',
    decades: {
      arrows: [
        'Decade: 1980s, with titles from the 1980s',
        'Decade: 1990s, with titles from the 1990s',
      ],
      then: 'a title in Browse by decade',
    },
  }
  assert.deepEqual(seen, {
    '1440px': expected,
    // The intro's buttons aren't drawn on a phone: Tab goes on from the search to the titles.
    '390px': { ...expected, search: { ...expected.search, then: 'a title in Trending now' } },
  })
})

/**
 * Loads the page and uses it by keyboard alone, and says what each step found. Each step goes on
 * from where the last left focus, and Tab finds the next control by its name (the walk holds their
 * order). A step that can't go on says why, and ends the journey there.
 */
async function keyboardJourney(screen: Parameters<Browser['load']>[0]) {
  await browser.load(screen)
  assert.ok(await browser.titlesShown())
  await browser.evaluate(SETTLED)
  const journey: Record<string, unknown> = {}
  const focus = async () =>
    (await browser.evaluate<{ name: string } | null>(STOP))?.name ?? 'nothing'
  const tabTo = async (name: string) => {
    for (let stop = 0; stop < 60; stop++) {
      await browser.press('Tab')
      if ((await focus()) === name) return true
    }
    journey.stopped = `Tab never reached "${name}"`
    return false
  }
  const next = async () => {
    await browser.press('Tab')
    return focus()
  }

  // Esc in a search box empties it (its own key in the browser), so the intro comes back.
  if (!(await tabTo('Search titles'))) return journey
  await browser.search('frieren')
  assert.ok(
    await browser.waitFor(`document.querySelector('.ab-results .ab-strip-panel[href]')`),
    'no results appeared',
  )
  await browser.press('Escape')
  await browser.waitFor(`document.querySelector('.ab-intro')`, 5_000)
  journey.search = {
    box: await browser.evaluate<string>(`document.querySelector('.ab-search textarea').value`),
    results: await browser.evaluate<boolean>(`Boolean(document.querySelector('.ab-results'))`),
    focus: await focus(),
    then: await next(),
  }

  // The arrows move a mood slider a stop at a time, stopping at its ends, and Home and End take
  // it to them: the word a screen reader hears, aria-valuetext, follows. Back at no preference,
  // Reset moods hides, so Tab goes on from the last slider to the lever.
  if (!(await tabTo('Energy'))) return journey
  const energy: string[] = []
  for (const key of [
    'ArrowLeft',
    'ArrowLeft',
    'ArrowLeft',
    'End',
    'Home',
    'ArrowRight',
    'ArrowRight',
  ] as const) {
    await browser.press(key)
    energy.push(
      `${await focus()}: ${await browser.evaluate<string>(`document.activeElement.getAttribute('aria-valuetext')`)}`,
    )
  }
  journey.energy = energy
  // The arrows on a decade chip move the choice with focus: the decade chosen is the one focused.
  const chosen = async () =>
    `${await focus()}${(await browser.evaluate<boolean>(`document.activeElement.checked`)) ? '' : ' (not chosen)'}`

  // Space pulls, and focus stays on the lever. With motion the capsule opens 900 ms later, and its
  // title takes focus only then (it is inert until it shows).
  journey.lever = [await next(), await next(), await next()]
  await browser.press('Space')
  if (!(await browser.waitFor(`document.querySelector('.ab-result.is-open')`, 5_000))) {
    journey.stopped = `Space on "${await focus()}" pulled nothing`
    return journey
  }
  const pulled = await browser.evaluate<string>(
    `document.querySelector('.ab-result h3').textContent`,
  )
  journey.pull = {
    focus: await focus(),
    count: await browser.evaluate<string>(`document.querySelector('.ab-count').textContent`),
    heard: (
      await browser.evaluate<string>(
        `document.querySelector('.ab-pull [role="status"]').textContent`,
      )
    ).startsWith(`Pull 1: ${pulled},`),
    then: [(await next()).replace(pulled, 'the pulled title'), await next()],
  }

  // Space on Open title card opens the card, on its Close button. Tab goes round the card and never
  // to the page behind it: past its last control Chrome takes focus to its own (none, run like
  // this), then back to the card. Taller than the screen, the card is a stop of its own. How many
  // stops a round has depends on the pulled title (Watch trailer, Read more and Show spoiler tags
  // show only for a trailer, a synopsis over five lines and spoiler tags), so Tab goes on until
  // focus is back on Close, 13 presses at most: up to 10 stops (Save, Want to try, Favorite,
  // Open on AniList, those three, Chrome's own, the card and Close) and 3 to spare.
  const opener = await focus()
  await browser.press('Space')
  if (!(await browser.waitFor(`document.querySelector('dialog.ab-card[open]')`, 5_000))) {
    journey.stopped = `Space on "${opener}" opened no title card`
    return journey
  }
  const first = await focus()
  const round: string[] = []
  for (let stop = 0; stop < 13 && round.at(-1) !== 'Close title card'; stop++) {
    await browser.press('Tab')
    const where = await browser.evaluate<string>(`(() => {
      const focused = document.activeElement
      return !focused || focused === document.body ? 'nothing' : focused.matches('dialog') ? 'the card' : focused.closest('dialog') ? 'in it' : 'the page'
    })()`)
    round.push(where === 'in it' ? await focus() : where)
  }
  const goesRound =
    !round.includes('the page') &&
    round.includes('Open on AniList') &&
    round.includes('Close title card')
  journey.card = { first, round: goesRound ? 'round the card' : round }

  // Space on Close closes the card, with focus back on what opened it.
  for (let stop = 0; stop < 13 && (await focus()) !== 'Close title card'; stop++)
    await browser.press('Tab')
  await browser.press('Space')
  if (!(await browser.waitFor(`!document.querySelector('dialog.ab-card')`, 5_000))) {
    journey.stopped = `Space on "${await focus()}" didn't close the title card`
    return journey
  }
  journey.closed = await focus()

  // The arrows on the decade chips change the strip's titles too, once its pause is over: the
  // decades of the years its titles show.
  const decadesShown = `[...new Set([...document.getElementById('decades').closest('section').querySelectorAll('.ab-strip-panel[href]')].map((panel) => Math.floor(Number(panel.textContent.match(/\\d{4}(?!.*\\d{4})/)?.[0]) / 10) * 10 + 's'))].join(' and ')`
  if (!(await tabTo('Decade: 1990s'))) return journey
  const decades: string[] = []
  for (const [key, decade] of [
    ['ArrowLeft', '1980s'],
    ['ArrowRight', '1990s'],
  ] as const) {
    await browser.press(key)
    await browser.waitFor(`${decadesShown} === '${decade}'`, 10_000)
    decades.push(`${await chosen()}, with titles from the ${await browser.evaluate(decadesShown)}`)
  }
  journey.decades = { arrows: decades, then: await next() }
  return journey
}

/**
 * How much the focused stop changes as focus comes off it, as a share of what WCAG's measure for a
 * focus indicator asks (2.4.13): the area of a 2px line around it, changed at 3:1 or better. It
 * compares the stop and 10px around it, as the screen shows it, focused and then blurred, and
 * focuses it again. Transitions are off meanwhile, so that it needn't wait for them: each state is
 * where they would end.
 */
async function focusShows() {
  await browser.evaluate(`(() => {
    const still = document.head.appendChild(document.createElement('style'))
    still.id = 'ab-walk-still'
    still.textContent = '*, ::before, ::after { transition: none !important }'
    return true
  })()`)
  await browser.evaluate(SETTLED)
  const area = await browser.evaluate<{
    clip: { x: number; y: number; width: number; height: number }
    need: number
    scale: number
  }>(`(() => {
    const focused = document.activeElement
    window.__walked = focused
    const shown = focused.matches('label > input') ? focused.nextElementSibling : focused.closest('.ab-bubble-field') ?? focused
    const box = shown.getBoundingClientRect()
    const left = Math.max(0, box.left - 10), top = Math.max(0, box.top - 10)
    const right = Math.min(innerWidth, box.right + 10), bottom = Math.min(innerHeight, box.bottom + 10)
    return {
      clip: { x: left + scrollX, y: top + scrollY, width: right - left, height: bottom - top },
      need: 4 * (box.width + box.height) - 16,
      scale: devicePixelRatio,
    }
  })()`)
  const focused = await browser.screenshot(area.clip)
  await browser.evaluate(`document.activeElement.blur(); true`)
  await browser.evaluate(SETTLED)
  const unfocused = await browser.screenshot(area.clip)
  await browser.evaluate(
    `window.__walked.focus({ preventScroll: true }); document.getElementById('ab-walk-still').remove(); true`,
  )
  // Compared in the page, as the pixels are many: WCAG's contrast, as contrast() works it out.
  const changed = await browser.evaluate<number>(`(async () => {
    const pixels = async (png) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, image.width, image.height).data
    }
    const linear = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
    const luminance = (data, i) => 0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) + 0.0722 * linear(data[i + 2])
    const [a, b] = await Promise.all([pixels(${JSON.stringify(focused)}), pixels(${JSON.stringify(unfocused)})])
    let changed = 0
    for (let i = 0; i < a.length; i += 4) {
      const [x, y] = [luminance(a, i), luminance(b, i)].sort((p, q) => q - p)
      if ((x + 0.05) / (y + 0.05) >= 3) changed++
    }
    return changed
  })()`)
  return changed / area.scale ** 2 / area.need
}

/** Names in order, with a run of the same name as one entry and its count ("a title ×9"). */
function runs(names: string[]) {
  const entries: [string, number][] = []
  for (const name of names) {
    const last = entries.at(-1)
    if (last?.[0] === name) last[1]++
    else entries.push([name, 1])
  }
  return entries.map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
}

/** The pixels of part of the page as the screen shows it, as red, green and blue for each pixel. */
async function screenPixels(clip: { x: number; y: number; width: number; height: number }) {
  const png = await browser.screenshot(clip)
  return browser.evaluate<{ width: number; rgb: number[] }>(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return { width: image.width, rgb: [...data].filter((_, i) => i % 4 !== 3) }
  })()`)
}

/** WCAG's contrast between two colors given as red, green and blue from 0 to 255. */
function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, k) => sum + v * [0.2126, 0.7152, 0.0722][k], 0)
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
