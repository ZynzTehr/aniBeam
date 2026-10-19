import assert from 'node:assert/strict'
import { test } from 'node:test'
import { oneLine, rowsShown } from './searchBox.ts'

test('a pasted line break, or a run of them, becomes one space, so the search stays one line', () => {
  assert.equal(oneLine('one\npiece'), 'one piece')
  assert.equal(oneLine('one\r\n\r\npiece\r'), 'one piece ')
  assert.equal(oneLine('one piece'), 'one piece')
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
