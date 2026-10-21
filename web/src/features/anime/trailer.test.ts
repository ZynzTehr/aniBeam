import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Media } from './queries.ts'
import { SAMPLES as samples } from './samples.ts'
import { trailerOf } from './trailer.ts'

/** A title whose trailer AniList gives as `trailer`, or leaves out, as a copy saved before did. */
const titled = (trailer: unknown) => ({ trailer }) as Media

test('trailerOf gives the id of a YouTube trailer as AniList sends it', () => {
  // Frieren's, as recorded, and ids with each of the other characters an id holds, - and _.
  assert.equal(trailerOf(titled({ id: 'tR8YH0G67Rk', site: 'youtube' })), 'tR8YH0G67Rk')
  assert.equal(trailerOf(titled({ id: 'RH-FcW94z00', site: 'youtube' })), 'RH-FcW94z00')
  assert.equal(trailerOf(titled({ id: '_VRxEEBa1XU', site: 'youtube' })), '_VRxEEBa1XU')
})

test('trailerOf trims the space AniList leaves around an id, as after one sample’s', () => {
  // AniList really sends this one with a tab after it (search-2de30bcb, and a sample).
  assert.equal(trailerOf(titled({ id: 'LHtdKWJdif4\t', site: 'youtube' })), 'LHtdKWJdif4')
  assert.equal(trailerOf(titled({ id: ' LHtdKWJdif4\n', site: ' youtube ' })), 'LHtdKWJdif4')
  const sample = samples.find((media) => media.trailer?.id?.startsWith('LHtdKWJdif4'))
  assert.ok(sample, 'no sample has the id AniList sends with a tab')
  assert.equal(trailerOf(sample), 'LHtdKWJdif4')
})

test('trailerOf gives null for a title with no trailer, or one on another site', () => {
  for (const trailer of [
    null,
    undefined,
    { id: null, site: null },
    { id: null, site: 'youtube' },
    { id: 'tR8YH0G67Rk', site: null },
    // AniList's other site: the dialog plays YouTube's alone, under its privacy-enhanced address.
    { id: 'x8bxd4w', site: 'dailymotion' },
    { id: 'tR8YH0G67Rk', site: 'dailymotion' },
    { id: 'tR8YH0G67Rk', site: 'YouTube.com' },
    { id: 'tR8YH0G67Rk', site: 'https://www.youtube.com' },
  ])
    assert.equal(trailerOf(titled(trailer)), null, JSON.stringify(trailer))
})

test('trailerOf gives null for an id that is not one, whatever it would make of an address', () => {
  // The id goes into the embed's address and the link to YouTube: anything but 11 of A-Z, a-z,
  // 0-9, - and _ could take either somewhere else, as from a saved copy someone edited.
  for (const id of [
    '',
    '   ',
    'tR8YH0G67R', // 10
    'tR8YH0G67Rkk', // 12
    'tR8YH0G67R k',
    'tR8YH0G67R\tk',
    '../../evil0',
    'tR8YH0G67Rk?autoplay=0',
    'tR8YH0G67Rk&list=x',
    'tR8YH0G67Rk#t=1',
    'tR8YH0G67Rk/',
    '"><script>',
    'javascript:',
    'tR8YH0G67R%',
    'tR8YH0G67Rк', // a Cyrillic к, which looks like a k
    'tR8YH0G67R​', // ending in a zero-width space, which trim keeps
    'https://youtu.be/tR8YH0G67Rk',
    12345678901,
    ['tR8YH0G67Rk'],
    { toString: () => 'tR8YH0G67Rk' },
    true,
  ])
    assert.equal(trailerOf(titled({ id, site: 'youtube' })), null, JSON.stringify(String(id)))
})

test('trailerOf gives an id for every sample with a YouTube trailer, and only for those', () => {
  // The bundled samples, as AniList gave them: 24 of 30 have a YouTube trailer.
  const withIds = samples.filter((media) => trailerOf(media) !== null)
  assert.deepEqual(
    withIds.map((media) => media.id),
    samples.filter((media) => media.trailer?.site === 'youtube').map((media) => media.id),
  )
  assert.equal(withIds.length, 24)
})
