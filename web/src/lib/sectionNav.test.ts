import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BAR_SLACK,
  barAfter,
  currentSection,
  dockedAfter,
  linkSet,
  sectionLine,
  UNDOCK_GAP,
} from './sectionNav.ts'

test('a section counts as reached two thirds of the way down the screen below the header', () => {
  // A 78px header on a 900px screen: 78 + (822 * 2/3).
  assert.equal(sectionLine(78, 900), 78 + 548)
  // A header scrolled away (a phone's) leaves the whole screen.
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

test('the set with focus stays shown; then a phone’s bar while in; with no intro the header’s; else docking decides', () => {
  const set = (
    introOnPage: boolean,
    docked: boolean,
    barIn: boolean,
    held: 'intro' | 'header' | 'bar' | null,
  ) => linkSet({ introOnPage, docked, barIn, held })
  assert.equal(set(true, false, false, null), 'intro')
  assert.equal(set(true, true, false, null), 'header')
  assert.equal(set(false, false, false, null), 'header')
  assert.equal(set(true, false, true, null), 'bar')
  assert.equal(set(false, false, true, null), 'bar')
  assert.equal(set(true, true, false, 'intro'), 'intro')
  assert.equal(set(true, false, false, 'header'), 'header')
  assert.equal(set(true, false, true, 'header'), 'header')
  assert.equal(set(true, false, false, 'bar'), 'bar')
})

// A phone scrolled to y, past the intro's buttons, focus on nothing in particular.
const scrolledTo = (y: number, more: Partial<Parameters<typeof barAfter>[1]> = {}) => ({
  y,
  eligible: true,
  focusInBar: false,
  focusUnder: false,
  fromFocus: false,
  dialogOpen: false,
  ...more,
})

test('a phone’s bar comes in on a scroll up of BAR_SLACK, from the lowest point, and goes out on as much down', () => {
  assert.equal(BAR_SLACK, 8)
  let bar = { barIn: false, anchor: 1000 }
  bar = barAfter(bar, scrolledTo(1500))
  assert.deepEqual(bar, { barIn: false, anchor: 1500 }, 'down: the anchor follows')
  bar = barAfter(bar, scrolledTo(1493))
  assert.deepEqual(bar, { barIn: false, anchor: 1500 }, '7px up: not yet')
  bar = barAfter(bar, scrolledTo(1492))
  assert.deepEqual(bar, { barIn: true, anchor: 1492 }, '8px up: in')
  bar = barAfter(bar, scrolledTo(1200))
  assert.deepEqual(bar, { barIn: true, anchor: 1200 }, 'up: the anchor follows')
  bar = barAfter(bar, scrolledTo(1207))
  assert.deepEqual(bar, { barIn: true, anchor: 1200 }, '7px down: still in')
  bar = barAfter(bar, scrolledTo(1208))
  assert.deepEqual(bar, { barIn: false, anchor: 1208 }, '8px down: out')
  assert.deepEqual(barAfter(bar, scrolledTo(1208)), bar, 'the same scroll changes nothing')
})

test('the bar stays out until what it stands for has gone, and never covers what has focus', () => {
  assert.deepEqual(barAfter({ barIn: false, anchor: 500 }, scrolledTo(300, { eligible: false })), {
    barIn: false,
    anchor: 300,
  })
  assert.deepEqual(barAfter({ barIn: true, anchor: 500 }, scrolledTo(400, { eligible: false })), {
    barIn: false,
    anchor: 400,
  })
  assert.deepEqual(barAfter({ barIn: true, anchor: 500 }, scrolledTo(490, { focusUnder: true })), {
    barIn: false,
    anchor: 490,
  })
})

test('focus in the bar keeps it in; a dialog, or a scroll focus made, leaves it as it is', () => {
  const inBar = { barIn: true, anchor: 500 }
  assert.equal(barAfter(inBar, scrolledTo(900, { focusInBar: true })).barIn, true, 'down 400px')
  assert.equal(barAfter(inBar, scrolledTo(900, { focusInBar: true, eligible: false })).barIn, true)
  assert.deepEqual(barAfter(inBar, scrolledTo(900, { fromFocus: true })), {
    barIn: true,
    anchor: 900,
  })
  assert.deepEqual(barAfter({ barIn: false, anchor: 900 }, scrolledTo(500, { fromFocus: true })), {
    barIn: false,
    anchor: 500,
  })
  assert.deepEqual(barAfter(inBar, scrolledTo(900, { dialogOpen: true })), {
    barIn: true,
    anchor: 900,
  })
})
