import assert from 'node:assert/strict'
import { test } from 'node:test'
import { landAfter, landingNow } from './landing.ts'

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
  ({ target, intersectionRatio }) as unknown as IntersectionObserverEntry
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
