import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Media } from './queries.ts'
import { SAMPLES as samples } from './samples.ts'
import { embedOf, trailerOf, watchOf } from './trailer.ts'

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

/**
 * A page for lib/motion.ts to ask, on globalThis until the test ends, as Node has none: <html>,
 * whose data-motion is `dataset.motion` (the site's Reduce motion switch), and a device that asks
 * for reduced motion while `device` is true.
 */
function fakePage(t: TestContext, { site = false, device = false }) {
  const saved = ['document', 'matchMedia'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  t.after(() => {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  const dataset: DOMStringMap = site ? { motion: 'reduce' } : {}
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { dataset } },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: device && query === '(prefers-reduced-motion: reduce)' }),
  })
}

test('the trailer plays from YouTube’s privacy-enhanced address, in the page on an iPhone, at once', (t) => {
  // youtube-nocookie.com, as spec §3A asks; rel=0, so what YouTube suggests at the end comes from
  // the trailer's own channel; playsinline=1, so an iPhone plays it in the dialog, not full screen;
  // and autoplay=1, as the visitor pressed "Watch trailer" to see it.
  fakePage(t, {})
  assert.equal(
    embedOf('tR8YH0G67Rk'),
    'https://www.youtube-nocookie.com/embed/tR8YH0G67Rk?rel=0&playsinline=1&autoplay=1',
  )
})

test('with reduced motion asked for, on the device or the site, the trailer waits to be played', (t) => {
  // Spec §3J: the trailer doesn't autoplay under reduced motion. The visitor presses play.
  for (const asked of [{ device: true }, { site: true }, { device: true, site: true }]) {
    fakePage(t, asked)
    assert.equal(
      embedOf('tR8YH0G67Rk'),
      'https://www.youtube-nocookie.com/embed/tR8YH0G67Rk?rel=0&playsinline=1',
      JSON.stringify(asked),
    )
  }
})

test('“Open on YouTube” goes to the trailer’s own page on YouTube', () => {
  assert.equal(watchOf('tR8YH0G67Rk'), 'https://www.youtube.com/watch?v=tR8YH0G67Rk')
})
