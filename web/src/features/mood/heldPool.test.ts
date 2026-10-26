import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Media } from '../anime/queries.ts'
import { heldPool, type Held } from './heldPool.ts'

// A pool of 100 titles, by id, each with a genre and a tag the scoring reads.
const title = (id: number, rank = 50, score: number | null = 70) =>
  ({
    id,
    averageScore: score,
    genres: ['Comedy'],
    tags: [{ name: 'Iyashikei', rank }],
  }) as unknown as Media
const pool = (
  era = '1990s',
  titles: readonly Media[] = Array.from({ length: 100 }, (_, i) => title(i + 1)),
): Held => ({
  era,
  titles,
})
const shown = pool()

test('off screen, a refreshed pool shows at once', () => {
  const latest = pool('1990s', shown.titles!.toReversed())
  assert.equal(heldPool(shown, latest, false), latest)
})

test('on screen, a refreshed pool in a new order waits, even past the first few titles', () => {
  const reordered = shown.titles!.toSpliced(40, 2, shown.titles![41], shown.titles![40])
  assert.equal(heldPool(shown, pool('1990s', reordered), true), shown)
})

test('on screen, a refresh that changes only rank 40’s tags waits, as a set slider can lift it', () => {
  const retagged = shown.titles!.with(39, title(40, 95))
  assert.equal(heldPool(shown, pool('1990s', retagged), true), shown)
  const rescored = shown.titles!.with(39, title(40, 50, 88))
  assert.equal(heldPool(shown, pool('1990s', rescored), true), shown, 'a new score showed')
})

test('on screen, a refresh the matches can’t tell apart shows at once', () => {
  const same = pool(
    '1990s',
    shown.titles!.map((media) => ({ ...media })),
  )
  assert.equal(heldPool(shown, same, true), same)
})

test('another decade’s pool shows at once, on screen or not', () => {
  const eighties = pool('1980s', shown.titles!.toReversed())
  assert.equal(heldPool(shown, eighties, true), eighties)
  // Even one with the same titles: the decade is what was asked for.
  const alike = pool('1980s', shown.titles)
  assert.equal(heldPool(shown, alike, true), alike)
})

test('the first pool, and no pool, show at once, on screen or not', () => {
  const none = { era: '1990s', titles: undefined }
  assert.equal(heldPool(none, shown, true), shown, 'the first pool waited')
  assert.equal(heldPool(shown, none, true), none, 'a pool that went stayed')
})

test('nothing new keeps what is shown', () => {
  assert.equal(heldPool(shown, { ...shown }, true), shown)
  assert.equal(heldPool(shown, { ...shown }, false), shown)
})
