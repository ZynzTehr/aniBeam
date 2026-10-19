import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyboardAfter, keyboardAt, oneLine, oneLineCaret, rowsShown } from './searchBox.ts'

test('a pasted line break, or a run of them, becomes one space, so the search stays one line', () => {
  assert.equal(oneLine('one\npiece'), 'one piece')
  assert.equal(oneLine('one\r\n\r\npiece\r'), 'one piece ')
  assert.equal(oneLine('one piece'), 'one piece')
})

test('the caret keeps its place in the text as pasted line breaks become spaces', () => {
  // 'one big\n\npiece', the caret just after the paste of 'big\n\n': after 'one big '.
  assert.equal(oneLineCaret('one big\n\npiece', 9), 8)
  assert.equal(oneLineCaret('one\r\npiece', 10), 9)
  assert.equal(oneLineCaret('one piece', 4), 4)
  // In the middle of a run of breaks, it goes after the space they become.
  assert.equal(oneLineCaret('one\n\npiece', 4), 4)
})

test('the box shows up to three rows of what is typed, and scrolls past them', () => {
  // Rows of 20px, the phone's; 30px, as widened text spacing can make them.
  assert.deepEqual(rowsShown(20, 20), { height: 20, over: false })
  assert.deepEqual(rowsShown(60, 20), { height: 60, over: false })
  assert.deepEqual(rowsShown(80, 20), { height: 60, over: true })
  assert.deepEqual(rowsShown(160, 20), { height: 60, over: true })
  assert.deepEqual(rowsShown(90, 30), { height: 90, over: false })
  assert.deepEqual(rowsShown(120, 30), { height: 90, over: true })
})

test('a touch keyboard is up once it takes a quarter of the screen the box had, and away once it gives back all but a tenth', () => {
  // A 390 by 844 phone; its keyboard leaves 480.
  let keyboard = keyboardAt({ width: 390, height: 844 })
  assert.deepEqual(keyboard, { width: 390, tallest: 844, up: false })
  // A browser's toolbar hiding gives more: the tallest follows. Showing again, it is no keyboard.
  let next = keyboardAfter(keyboard, { width: 390, height: 900 })
  assert.deepEqual(next, { width: 390, tallest: 900, up: false, away: false }, 'the toolbar hid')
  next = keyboardAfter(next, { width: 390, height: 844 })
  assert.deepEqual(next, { width: 390, tallest: 900, up: false, away: false }, 'and showed')
  // The keyboard sliding up, a step at a time: up once it has taken a quarter.
  next = keyboardAfter(keyboardAt({ width: 390, height: 844 }), { width: 390, height: 700 })
  assert.equal(next.up, false, '144px of 844 is no keyboard yet')
  next = keyboardAfter(next, { width: 390, height: 480 })
  assert.deepEqual(next, { width: 390, tallest: 844, up: true, away: false }, 'the keyboard up')
  // On its way down it isn't away until all but a tenth is back.
  next = keyboardAfter(next, { width: 390, height: 700 })
  assert.deepEqual(next, { width: 390, tallest: 844, up: true, away: false }, 'on its way down')
  next = keyboardAfter(next, { width: 390, height: 844 })
  assert.deepEqual(next, { width: 390, tallest: 844, up: false, away: true }, 'put away')
  // Once only: the next look finds it neither up nor going away.
  keyboard = next
  assert.equal(keyboardAfter(keyboard, { width: 390, height: 844 }).away, false, 'twice')
})

test('a turn of the phone starts the keyboard again, so its new height is never taken for one', () => {
  // Turned sideways with the keyboard up, then put away: a shorter screen, but no keyboard came.
  let keyboard = keyboardAfter(keyboardAt({ width: 390, height: 844 }), { width: 390, height: 480 })
  keyboard = keyboardAfter(keyboard, { width: 844, height: 200 })
  assert.deepEqual(keyboard, { width: 844, tallest: 200, up: false, away: false }, 'turned')
  keyboard = keyboardAfter(keyboard, { width: 844, height: 390 })
  assert.deepEqual(keyboard, { width: 844, tallest: 390, up: false, away: false }, 'put away')
})
