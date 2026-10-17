import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coveredBy, landAfter, landingNow, outOfSight, slivers } from './landing.ts'

// Parts as an IntersectionObserver hands them over: each its place in the page (its order in the
// markup), how it stands (data-land), and how much of it shows.
function part(place: number, land?: string) {
  return {
    place,
    dataset: land === undefined ? {} : { land },
    // As the DOM answers: 4 means `other` comes after this one in the page.
    compareDocumentPosition(other: { place: number }) {
      return other.place > place ? 4 : 2
    },
  }
}
const seen = (target: ReturnType<typeof part>, intersectionRatio: number) =>
  ({
    target,
    intersectionRatio,
    isIntersecting: intersectionRatio > 0,
  }) as unknown as IntersectionObserverEntry
const places = (parts: Element[]) => parts.map((p) => (p as unknown as { place: number }).place)

test('the waiting parts with 15% or more on screen land, and no others', () => {
  // Give or take Chrome's rounding: it can report a ratio a hair under the threshold it fired at.
  const entries = [
    seen(part(1, 'wait'), 0.1495),
    seen(part(2, 'wait'), 0.14),
    seen(part(3, 'wait'), 1),
    seen(part(4, 'go'), 1),
    seen(part(5, 'done'), 1),
    seen(part(6), 1),
    seen(part(7, 'wait'), 0),
    // The give is a hair, not a margin: 0.148 is short of it.
    seen(part(8, 'wait'), 0.148),
  ]
  assert.deepEqual(places(landingNow(entries)), [1, 3])
})

test('parts that come into view together land in reading order, whatever order they were seen in', () => {
  const entries = [5, 2, 9, 1, 7].map((place) => seen(part(place, 'wait'), 0.5))
  assert.deepEqual(places(landingNow(entries)), [1, 2, 5, 7, 9])
})

test('a part waits, lands once seen, and is done once its slam has played', () => {
  assert.equal(landAfter(undefined, 'found'), 'wait')
  assert.equal(landAfter('wait', 'seen'), 'go')
  assert.equal(landAfter('go', 'played'), 'done')
  // Seen again, or its slam ending again, changes nothing: a part lands once.
  assert.equal(landAfter('go', 'seen'), 'go')
  assert.equal(landAfter('done', 'seen'), 'done')
  assert.equal(landAfter('done', 'played'), 'done')
  assert.equal(landAfter('done', 'found'), 'done')
  // A slam that ends for a part that never went (it was focused first) changes nothing either.
  assert.equal(landAfter('wait', 'played'), 'wait')
})

test('keyboard focus lands a part at once, waiting or mid-slam', () => {
  assert.equal(landAfter('wait', 'focused'), 'done')
  assert.equal(landAfter('go', 'focused'), 'done')
  assert.equal(landAfter('done', 'focused'), 'done')
})

test('a waiting part in view, but under 15% of it, is a sliver: it lands only if it stays', () => {
  const entries = [
    seen(part(3, 'wait'), 0.05),
    seen(part(1, 'wait'), 0.001),
    seen(part(2, 'wait'), 0.1495),
    seen(part(4, 'wait'), 0),
    seen(part(5, 'done'), 0.05),
    seen(part(6, 'go'), 0.05),
  ]
  // 0.1495 lands at once (see above); a part not in view at all is none; only waiting parts count.
  assert.deepEqual(places(slivers(entries)), [1, 3])
})

test('a part out of view is one whose wait to land as a sliver ends', () => {
  const entries = [seen(part(1, 'wait'), 0), seen(part(2, 'wait'), 0.05), seen(part(3, 'go'), 0)]
  // Touching the screen's edge, the observer calls a part intersecting, with nothing of it in view.
  const touching = {
    ...seen(part(4, 'wait'), 0),
    isIntersecting: true,
  } as IntersectionObserverEntry
  assert.deepEqual(places(outOfSight([...entries, touching])), [1, 3, 4])
})

test('the observer starts below a header that stays on screen, rounded up, and at the top otherwise', () => {
  // At 960px with widened text spacing the header is 137.19px: the 0.19px under it isn't seen.
  assert.equal(coveredBy(137.1875, true), 138)
  assert.equal(coveredBy(78, true), 78)
  assert.equal(coveredBy(230.4, false), 0)
})
