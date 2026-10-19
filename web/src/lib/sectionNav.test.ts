import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  currentSection,
  dockedAfter,
  FLIGHT,
  flightFrames,
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

test('the set with focus stays shown; with no intro the header’s; else docking decides', () => {
  const set = (introOnPage: boolean, docked: boolean, held: 'intro' | 'header' | null) =>
    linkSet({ introOnPage, docked, held })
  assert.equal(set(true, false, null), 'intro')
  assert.equal(set(true, true, null), 'header')
  assert.equal(set(false, false, null), 'header')
  assert.equal(set(true, true, 'intro'), 'intro')
  assert.equal(set(true, false, 'header'), 'header')
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
