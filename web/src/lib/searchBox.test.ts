import assert from 'node:assert/strict'
import { test } from 'node:test'
import { oneLine, oneLineCaret, rowsShown } from './searchBox.ts'

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
