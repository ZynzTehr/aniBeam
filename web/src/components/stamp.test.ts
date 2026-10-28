// The stamp on a listed title's cover (stamp.ts): what it shows, and what a screen reader hears at
// the end of the cover's name, on Discover and on My List.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entryIn, type Entry, type Status } from '../features/list/store.ts'
import { stampOf } from './stamp.ts'

const T = Date.UTC(2026, 9, 28, 12)
const entry = (status: Status, favorite = false): Entry => ({ status, favorite, updatedAt: T })

/** What a stamp shows and says, in a line: its word, its heart, then its words; or "none". */
const seen = (shown: ReturnType<typeof stampOf>) =>
  shown ? `${shown.word ?? 'no word'}${shown.heart ? ' ♥' : ''}: "${shown.spoken}"` : 'none'

test('a listed cover shows SAVED or WANT, with a heart for a favorite, and its name ends with them', () => {
  assert.deepEqual(
    [entry('SAVED'), entry('SAVED', true), entry('WANT'), entry('WANT', true)].map((listed) =>
      seen(stampOf(listed)),
    ),
    [
      'SAVED: ", saved"',
      'SAVED ♥: ", saved, favorite"',
      'WANT: ", want to try"',
      'WANT ♥: ", want to try, favorite"',
    ],
  )
})

test('a title not on the list, or taken off it, has no stamp, and nothing is added to its name', () => {
  assert.equal(stampOf(undefined), null, 'never on the list')
  const list = { '1': { ...entry('SAVED', true), deleted: true as const } }
  assert.equal(stampOf(entryIn(list, 1)), null, 'its delete marker')
})

test('on My List, a stamp says only what the page doesn’t: the word off its tab, the heart off Favorites only', () => {
  const states = [entry('SAVED'), entry('SAVED', true), entry('WANT'), entry('WANT', true)]
  const on = (tab: Status, favoritesOnly = false) =>
    states.map((listed) => seen(stampOf(listed, { tab, favoritesOnly })))
  // On the Saved tab, every title says Saved already: a favorite keeps its heart, and a title moved
  // to Want to try in its card, which stays in the view it opened with, says so.
  assert.deepEqual(on('SAVED'), [
    'none',
    'no word ♥: ", favorite"',
    'WANT: ", want to try"',
    'WANT ♥: ", want to try, favorite"',
  ])
  assert.deepEqual(on('WANT'), [
    'SAVED: ", saved"',
    'SAVED ♥: ", saved, favorite"',
    'none',
    'no word ♥: ", favorite"',
  ])
  // Favorites only shows favorites alone, so the heart says nothing new: only a move does.
  assert.deepEqual(on('SAVED', true), [
    'none',
    'none',
    'WANT: ", want to try"',
    'WANT: ", want to try"',
  ])
  assert.deepEqual(on('WANT', true), ['SAVED: ", saved"', 'SAVED: ", saved"', 'none', 'none'])
})

test('each thing a stamp can show has a key of its own, so a change draws a new stamp', () => {
  const shown = [
    stampOf(entry('SAVED')),
    stampOf(entry('SAVED', true)),
    stampOf(entry('WANT')),
    stampOf(entry('WANT', true)),
    stampOf(entry('SAVED', true), { tab: 'SAVED' }),
  ]
  const keys = shown.map((stamp) => stamp?.key)
  assert.equal(new Set(keys).size, shown.length, `keys ${keys.join(', ')}`)
  // And the same state, read again, keeps its key: a stamp is drawn again only as it changes.
  assert.equal(
    stampOf(entry('WANT', true))?.key,
    stampOf({ ...entry('WANT', true), updatedAt: 0 })?.key,
  )
})
