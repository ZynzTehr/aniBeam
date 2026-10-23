import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  copyLook,
  currentSection,
  dockedAfter,
  FLIGHT,
  flightFrames,
  flightPairs,
  HIDE_SLACK,
  linkSet,
  LIST_HREF,
  sectionLine,
  SHOW_SLACK,
  topAfter,
  UNDOCK_GAP,
} from './sectionNav.ts'

test('a section counts as reached two thirds of the way down the screen below the header', () => {
  // A 78px header on a 900px screen: 78 + (822 * 2/3).
  assert.equal(sectionLine(78, 900), 78 + 548)
  // A header hidden up the screen (a phone's, as the page scrolls down) leaves the whole screen.
  assert.equal(sectionLine(-120, 844), (844 * 2) / 3)
  assert.equal(sectionLine(0, 600), 400)
})

test('the section the visitor is in is the last whose top has passed the line', () => {
  assert.equal(currentSection([900, 1800, 2600], 600, false), -1, 'above the first')
  assert.equal(currentSection([600, 1500, 2300], 600, false), 0, 'on the line counts')
  assert.equal(currentSection([601, 1500, 2300], 600, false), -1, 'a pixel short does not')
  assert.equal(currentSection([-900, 300, 1100], 600, false), 1)
  assert.equal(currentSection([-2000, -1200, -100], 600, false), 2)
  // A section not on the page is skipped.
  assert.equal(currentSection([-900, undefined, 1100], 600, false), 0)
})

test('at the end of the page the last section is the visitor’s, short as it may be', () => {
  // Its top can't reach the line once the page can scroll no further.
  assert.equal(currentSection([-1400, -600, 700], 600, true), 2)
  assert.equal(currentSection([-1400, -600, undefined], 600, true), 1)
  assert.equal(currentSection([undefined, undefined, undefined], 600, true), -1)
})

// A 78px sticky header, the intro's buttons 600px below it at the top of the page.
const at = (actionsTop: number, scrollY: number, homeGap = 600) => ({
  actionsTop,
  headerBottom: 78,
  homeGap,
  scrollY,
})

test('the intro’s buttons dock as the header reaches them, and not a pixel before', () => {
  assert.equal(dockedAfter(false, at(79, 599)), false)
  assert.equal(dockedAfter(false, at(78, 600)), true)
  assert.equal(dockedAfter(false, at(-400, 1078)), true)
})

test('docked, they stay until their place is UNDOCK_GAP below the header, or the page is at its top', () => {
  assert.equal(UNDOCK_GAP, 200)
  assert.equal(dockedAfter(true, at(78 + 100, 500)), true, 'within the band')
  assert.equal(dockedAfter(true, at(78 + 199, 401)), true)
  assert.equal(dockedAfter(true, at(78 + 200, 400)), false, 'at the gap')
  // Not docked, the same place in the band doesn't dock them: they stay as they were.
  assert.equal(dockedAfter(false, at(78 + 100, 500)), false)
  // On a short screen, where they sit closer than the gap at the top, they undock at their place.
  assert.equal(dockedAfter(true, at(78 + 120, 30, 150)), true)
  assert.equal(dockedAfter(true, at(78 + 150, 1, 150)), false)
  // A header taller than where they sit (a second row) counts as no gap.
  assert.equal(dockedAfter(true, at(78, 10, -20)), false)
  assert.equal(dockedAfter(true, at(-500, 0)), false, 'the top of the page')
})

test('the set with focus stays shown; with no intro the header’s; else docking decides', () => {
  const set = (introOnPage: boolean, docked: boolean, held: 'intro' | 'header' | null) =>
    linkSet({ introOnPage, docked, held })
  assert.equal(set(true, false, null), 'intro')
  assert.equal(set(true, true, null), 'header')
  assert.equal(set(false, false, null), 'header')
  assert.equal(set(true, true, 'intro'), 'intro')
  assert.equal(set(true, false, 'header'), 'header')
})

// A phone scrolled to y, well past its header, focus on nothing in particular.
const scrolledTo = (y: number, more: Partial<Parameters<typeof topAfter>[1]> = {}) => ({
  y,
  eligible: true,
  focusInTop: false,
  focusUnder: false,
  fromFocus: false,
  dialogOpen: false,
  ...more,
})

test('a phone’s header hides on a scroll down of HIDE_SLACK from the highest point, and comes back on SHOW_SLACK up from the lowest', () => {
  assert.equal(HIDE_SLACK, 12)
  assert.equal(SHOW_SLACK, 8)
  let top = { hidden: false, anchor: 1000 }
  top = topAfter(top, scrolledTo(900))
  assert.deepEqual(top, { hidden: false, anchor: 900 }, 'up: the highest point follows')
  top = topAfter(top, scrolledTo(911))
  assert.deepEqual(top, { hidden: false, anchor: 900 }, '11px down: not yet')
  top = topAfter(top, scrolledTo(912))
  assert.deepEqual(top, { hidden: true, anchor: 912 }, '12px down: hidden')
  top = topAfter(top, scrolledTo(1500))
  assert.deepEqual(top, { hidden: true, anchor: 1500 }, 'down: the lowest point follows')
  top = topAfter(top, scrolledTo(1493))
  assert.deepEqual(top, { hidden: true, anchor: 1500 }, '7px up: not yet')
  top = topAfter(top, scrolledTo(1492))
  assert.deepEqual(top, { hidden: false, anchor: 1492 }, '8px up: back')
  assert.deepEqual(topAfter(top, scrolledTo(1492)), top, 'the same scroll changes nothing')
})

test('a phone’s header shows near the top of the page, and while focus with its ring is in it', () => {
  const hidden = { hidden: true, anchor: 500 }
  assert.deepEqual(topAfter(hidden, scrolledTo(60, { eligible: false })), {
    hidden: false,
    anchor: 60,
  })
  assert.deepEqual(topAfter(hidden, scrolledTo(900, { focusInTop: true })), {
    hidden: false,
    anchor: 900,
  })
  assert.deepEqual(
    topAfter({ hidden: false, anchor: 500 }, scrolledTo(900, { focusInTop: true })),
    {
      hidden: false,
      anchor: 900,
    },
  )
})

test('a dialog, a scroll focus made, or a change of size leaves a phone’s header as it is', () => {
  const shown = { hidden: false, anchor: 500 }
  const hidden = { hidden: true, anchor: 900 }
  for (const more of [{ dialogOpen: true }, { fromFocus: true }, { settle: true }]) {
    assert.deepEqual(topAfter(shown, scrolledTo(900, more)), { hidden: false, anchor: 900 })
    assert.deepEqual(topAfter(hidden, scrolledTo(500, more)), { hidden: true, anchor: 500 })
  }
  // Not even near the top, or with focus in it: the page behind a dialog is held still.
  assert.deepEqual(topAfter(hidden, scrolledTo(40, { dialogOpen: true, eligible: false })), {
    hidden: true,
    anchor: 40,
  })
})

test('a phone’s header never covers a focus ring: it waits to come back, and goes up as one comes under it', () => {
  const hidden = { hidden: true, anchor: 900 }
  assert.deepEqual(topAfter(hidden, scrolledTo(880, { focusUnder: true })), hidden)
  assert.deepEqual(topAfter(hidden, scrolledTo(880)), { hidden: false, anchor: 880 })
  // Shown, with focus moved under it, by a script or a key, whether or not the page scrolled.
  const shown = { hidden: false, anchor: 500 }
  for (const more of [{}, { fromFocus: true }, { settle: true }])
    assert.deepEqual(topAfter(shown, scrolledTo(500, { focusUnder: true, ...more })), {
      hidden: true,
      anchor: 500,
    })
})

test('the flight is one 420 ms move with a slight overshoot, the buttons 45 ms apart', () => {
  assert.deepEqual(FLIGHT, {
    duration: 420,
    stagger: 45,
    easing: 'cubic-bezier(0.2, 1.35, 0.35, 1)',
  })
})

test('a flight moves from the middle of one box to the other’s, resizes the pill, and swaps the labels halfway, inside it, with transforms, opacity and a clip only', () => {
  // A 180x48 button 600px down, flying to a 90x44 header slot.
  const frames = flightFrames(
    { left: 48, top: 600, width: 180, height: 48 },
    { left: 238, top: 16, width: 90, height: 44 },
  )
  assert.deepEqual(frames.move, [{ transform: 'translate(-145px, 586px)' }, { transform: 'none' }])
  assert.deepEqual(frames.pill, [{ transform: `scale(2, ${48 / 44})` }, { transform: 'none' }])
  assert.deepEqual(frames.leaving, [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }])
  assert.deepEqual(frames.arriving, [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }])
  // The labels' box clipped to the inside of the pill's 3px border, from the button's size,
  // 45px further out at each side and 2px above and below, to the link's.
  assert.deepEqual(frames.text, [
    { clipPath: 'inset(1px -42px round 999px)' },
    { clipPath: 'inset(3px round 999px)' },
  ])
  const properties = Object.values(frames).flatMap((keyframes) =>
    keyframes.flatMap((frame) => Object.keys(frame).filter((key) => key !== 'offset')),
  )
  assert.deepEqual([...new Set(properties)].sort(), ['clipPath', 'opacity', 'transform'])
})

test('a copy’s shadow fades from the look of the end it leaves to the end it lands on', () => {
  const box = { left: 0, top: 0, width: 100, height: 40 }
  assert.deepEqual(flightFrames(box, box).shadow, [{ opacity: 1 }, { opacity: 1 }])
  // An intro button, shadowed, to a plain header link: it fades out.
  assert.deepEqual(flightFrames(box, box, { from: true, to: false }).shadow, [
    { opacity: 1 },
    { opacity: 0 },
  ])
  assert.deepEqual(flightFrames(box, box, { from: false, to: true }).shadow, [
    { opacity: 0 },
    { opacity: 1 },
  ])
})

test('a copy has its shadow as an intro button and as the current section’s link, lands yellow only on that link, and My List’s has neither, current or not', () => {
  assert.deepEqual(copyLook({ toHeader: true, current: false, soon: false }), {
    shadows: { from: true, to: false },
    yellow: false,
  })
  assert.deepEqual(copyLook({ toHeader: true, current: true, soon: false }), {
    shadows: { from: true, to: true },
    yellow: true,
  })
  assert.deepEqual(copyLook({ toHeader: false, current: false, soon: false }), {
    shadows: { from: false, to: true },
    yellow: false,
  })
  assert.deepEqual(copyLook({ toHeader: false, current: true, soon: false }), {
    shadows: { from: true, to: true },
    yellow: false,
  })
  // My List has no address, so above the first section, where none is current, it matches "no
  // section" as `current`: it still lands plain.
  for (const toHeader of [true, false])
    for (const current of [true, false])
      assert.deepEqual(
        copyLook({ toHeader, current, soon: true }),
        { shadows: { from: false, to: false }, yellow: false },
        `My List ${toHeader ? 'docking' : 'undocking'}${current ? ', taken for current' : ''}`,
      )
})

test('each intro button flies to the header’s link with its address, in order, My List last by its page’s, /list; one with no partner stays put', () => {
  assert.equal(LIST_HREF, '/list')
  // Each set as a map from an address to the name of what has it.
  const find = (set: Record<string, string>) => (href: string) => set[href]
  const intro = {
    '#ab-trending': 'See what’s trending',
    '#pull': 'Pull a random title',
    '#decades': 'Browse by decade',
    '/list': 'My List',
  }
  const header = {
    '/list': 'My List',
    '#decades': 'Decades',
    '#pull': 'Pull',
    '#ab-trending': 'Trending',
  }
  const pairs = (button: Record<string, string>, link: Record<string, string>) =>
    flightPairs(find(button), find(link)).map((pair) => `${pair.button} to ${pair.link}`)
  assert.deepEqual(pairs(intro, header), [
    'See what’s trending to Trending',
    'Pull a random title to Pull',
    'Browse by decade to Decades',
    'My List to My List',
  ])
  // My List with some other address at one end, a fragment, say, is no pair: nor is it a section.
  const { '/list': _, ...sections } = header
  assert.deepEqual(pairs(intro, { ...sections, '#my-list': 'My List' }).length, 3)
  assert.deepEqual(pairs({}, header), [])
})
