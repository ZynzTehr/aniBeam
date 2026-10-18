import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byPointer } from './jumps.ts'

test('a click with a pointer type came from a pointer, and one fired by a key has none', () => {
  assert.equal(byPointer('mouse', 'key'), true)
  assert.equal(byPointer('touch', 'key'), true)
  assert.equal(byPointer('pen', 'key'), true)
  // Enter on a link, or a screen reader's default action (Chrome, Firefox).
  assert.equal(byPointer('', 'pointer'), false)
})

test('a click with no pointer type at all (an older Safari) goes by the last input before it', () => {
  assert.equal(byPointer(undefined, 'pointer'), true)
  assert.equal(byPointer(undefined, 'key'), false)
})
