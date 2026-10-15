import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AXES, wordOf } from './moods.ts'

test('each mood axis names its 5 stops with 5 different words, the middle one "No preference"', () => {
  assert.deepEqual(Object.keys(AXES), ['energy', 'tone', 'complexity'])
  for (const [name, { words }] of Object.entries(AXES)) {
    assert.equal(words.length, 5, `${name} has ${words.length} stops`)
    assert.equal(new Set(words).size, 5, `${name} names two stops alike: ${words.join(', ')}`)
    assert.equal(words[2], 'No preference', `${name}'s middle stop`)
  }
})

test('a stop from -2 to 2 reads as its word', () => {
  assert.equal(wordOf('energy', -2), 'Very cozy')
  assert.equal(wordOf('tone', 0), 'No preference')
  assert.equal(wordOf('complexity', 2), 'Very cerebral')
})
