import assert from 'node:assert/strict'
import { test } from 'node:test'
import { steadyList } from './steadyList.ts'

// Titles by id. A refresh can also change a title's details, such as its score.
const titles = (...ids: number[]) => ids.map((id) => ({ id, score: 80 }))
// On screen: the first 3 of these.
const shown = titles(1, 2, 3, 4)

test('off screen, a refresh shows at once, in its new order', () => {
  const latest = titles(4, 3, 2, 1)
  assert.equal(steadyList(shown, latest, false, 3), latest, 'the new order waited off screen')
})

test('the first titles show at once, even on screen', () => {
  const latest = titles(1, 2, 3, 4)
  assert.equal(steadyList([], latest, true, 3), latest, 'the first titles waited')
})

test('an empty refresh shows at once, even on screen', () => {
  // An empty list has no order to hold back, and the section's note then says "No titles found.":
  // titles held on screen would show right under it.
  const empty = titles()
  const emptied = steadyList(shown, empty, true, 3)
  assert.equal(emptied, empty, 'the old titles stayed under "No titles found."')
  // Only an empty one: a shorter list in a new order still waits.
  const shortened = steadyList(shown, titles(2, 1), true, 3)
  assert.equal(shortened, shown, 'the titles in view took a shorter list’s order')
})

test('a decoration keeps what it shows when a refresh comes back empty, on screen or off', () => {
  // The intro's cover fan has no note to say there are no titles, and on a phone its place would
  // close up, moving the headline under it.
  const keep = { keepWhenEmpty: true }
  const empty = titles()
  const onScreen = steadyList(shown, empty, true, 3, keep)
  assert.equal(onScreen, shown, 'the fan’s covers went with an empty refresh while on screen')
  const offScreen = steadyList(shown, empty, false, 3, keep)
  assert.equal(offScreen, shown, 'the fan’s covers went with an empty refresh off screen')
  // Only an empty one: off screen, new covers still show at once.
  const latest = titles(4, 3, 2, 1)
  const renewed = steadyList(shown, latest, false, 3, keep)
  assert.equal(renewed, latest, 'the fan’s new covers waited off screen')
})

test('on screen, a new order of the titles in view waits', () => {
  const reordered = steadyList(shown, titles(2, 1, 3, 4), true, 3)
  assert.equal(reordered, shown, 'the titles in view took a new order')
  // A new title in view is a new order too, even in the last place.
  const replaced = steadyList(shown, titles(1, 2, 5, 4), true, 3)
  assert.equal(replaced, shown, 'a new title took the place of one in view')
})

test('on screen, the same order with new details shows at once', () => {
  const latest = shown.map((title) => ({ ...title, score: 81 }))
  assert.equal(steadyList(shown, latest, true, 3), latest, 'the new details waited')
})

test('on screen, a new order past the titles in view shows at once', () => {
  const latest = titles(1, 2, 3, 5)
  assert.equal(steadyList(shown, latest, true, 3), latest, 'a change out of view waited')
})
