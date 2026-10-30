import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roomKeySchema } from './room-key.ts'

const valid = (key: unknown) => roomKeySchema.safeParse(key).success

test('an episode room and an all room pass', () => {
  assert.equal(valid('anime:154587:ep:5'), true)
  assert.equal(valid('anime:1:all'), true)
  // The largest each part allows: a 10-digit id and a 5-digit episode.
  assert.equal(valid('anime:9999999999:ep:99999'), true)
})

test('anime:0 and ep:0 are refused', () => {
  assert.equal(valid('anime:0:all'), false)
  assert.equal(valid('anime:1:ep:0'), false)
})

test('a leading zero is refused, so one room never has two keys', () => {
  assert.equal(valid('anime:01:all'), false)
  assert.equal(valid('anime:1:ep:05'), false)
})

test('a suffix, a prefix or a missing part is refused', () => {
  assert.equal(valid('anime:1:all:x'), false)
  assert.equal(valid('anime:1:ep:5x'), false)
  assert.equal(valid('xanime:1:all'), false)
  assert.equal(valid('anime:1'), false)
  assert.equal(valid('anime:1:ep:'), false)
  assert.equal(valid(''), false)
})

test('wrong case is refused', () => {
  assert.equal(valid('Anime:1:all'), false)
  assert.equal(valid('anime:1:ALL'), false)
  assert.equal(valid('anime:1:EP:5'), false)
})

test('a trailing newline or space is refused', () => {
  assert.equal(valid('anime:1:all\n'), false)
  assert.equal(valid('anime:1:ep:5 '), false)
  assert.equal(valid(' anime:1:all'), false)
})

test('a number too long for its part, or not a string, is refused', () => {
  assert.equal(valid('anime:12345678901:all'), false)
  assert.equal(valid('anime:1:ep:123456'), false)
  assert.equal(valid(154587), false)
  assert.equal(valid(null), false)
})
