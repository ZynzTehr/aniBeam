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

test("each axis's words run from its low end to its high end, as its track does", () => {
  for (const [name, { ends, words }] of Object.entries(AXES)) {
    const [low, high] = ends.map((end) => end.toLowerCase())
    const [veryLow, lowWord, , highWord, veryHigh] = words.map((word) => word.toLowerCase())
    // -1 is the low end's word, and -2 more of it; 1 begins the high end's, and 2 is more of it.
    assert.equal(lowWord, low, `${name} at -1`)
    assert.ok(veryLow.endsWith(lowWord) && veryLow !== lowWord, `${name} at -2: ${veryLow}`)
    assert.ok(high.startsWith(highWord), `${name} at 1: ${highWord}, toward ${high}`)
    assert.ok(veryHigh.endsWith(highWord) && veryHigh !== highWord, `${name} at 2: ${veryHigh}`)
  }
})
