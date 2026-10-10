import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Media } from '../anime/queries.ts'
import { pickTitle, pullable } from './pick.ts'

const title = (id: number, genres: string[]) => ({ id, genres }) as Media
const pool = [
  title(1, ['Action']),
  title(2, ['Comedy', 'Slice of Life']),
  title(3, ['Action', 'Drama']),
  title(4, ['Romance']),
  title(5, ['Sports']),
]
// A stand-in for Math.random that walks through fixed values.
const sequence =
  (...values: number[]) =>
  () =>
    values.shift() ?? 0

test('a pull only picks titles with one of the vibe genres', () => {
  for (let i = 0; i < 20; i++) {
    const pick = pickTitle(pool, ['Action'], new Set(), Math.random)
    assert.ok(pick && pick.genres.includes('Action'), `picked ${pick?.id}`)
  }
})

test('a vibe matches titles that have any one of its genres', () => {
  // Title 2 has Comedy but not Sports, and title 5 has Sports but not Comedy: the vibe's only
  // matches. Draw 0 takes the first match and 0.99 the last, so both come up, in either order.
  const first = pickTitle(pool, ['Comedy', 'Sports'], new Set(), sequence(0))
  const last = pickTitle(pool, ['Comedy', 'Sports'], new Set(), sequence(0.99))
  assert.deepEqual(new Set([first?.id, last?.id]), new Set([2, 5]))
})

test('no title repeats until every match has come up once', () => {
  // This holds whatever the draw, so fixed draws make a broken pickTitle fail every run, not
  // just by chance. 0 always takes the first unseen title and 0.99 the last, so a title at
  // either end that never counts as seen comes up twice.
  for (const draw of [0, 0.99]) {
    const seen = new Set<number>()
    for (let i = 0; i < pool.length; i++) {
      const pick = pickTitle(pool, [], seen, () => draw)!
      assert.ok(!seen.has(pick.id), `title ${pick.id} came up twice (draw ${draw})`)
      seen.add(pick.id)
    }
    assert.equal(seen.size, pool.length)
  }
})

test('after every match has come up, pulls repeat matches instead of leaving the vibe', () => {
  const seen = new Set([1, 3]) // both Action titles already pulled
  for (let i = 0; i < 10; i++) {
    const pick = pickTitle(pool, ['Action'], seen, Math.random)
    assert.ok(pick && [1, 3].includes(pick.id), `picked ${pick?.id}`)
  }
})

test('a vibe with no matches falls back to the whole pool', () => {
  const pick = pickTitle(pool, ['Mecha'], new Set(), sequence(0.99))
  assert.equal(pick?.id, 5)
})

test('an empty pool gives nothing to pull', () => {
  assert.equal(pickTitle([], ['Action'], new Set(), Math.random), null)
})

// Spec §3G: Ecchi stays out of the gacha (browse and search still show it).
test('a pull never hands out an Ecchi title, whatever the vibe', () => {
  const pool = [title(2, ['Comedy']), title(9, ['Comedy', 'Ecchi'])]
  // 0.99 lands on the last candidate, which is the Ecchi title whenever it is allowed.
  assert.equal(pickTitle(pool, ['Comedy'], new Set(), sequence(0.99))?.id, 2)
  assert.equal(pickTitle(pool, [], new Set(), sequence(0.99))?.id, 2)
  assert.equal(pickTitle(pool, ['Mecha'], new Set(), sequence(0.99))?.id, 2) // no match: fallback
  assert.equal(pickTitle(pool, ['Comedy'], new Set([2]), sequence(0.99))?.id, 2) // repeats skip it too
  assert.equal(pickTitle([title(9, ['Ecchi'])], [], new Set(), sequence(0)), null)
})

// The machine shows these in its dome and turns the lever off without any.
test('only titles that aren’t Ecchi can come out of the machine', () => {
  const pool = [title(2, ['Comedy']), title(9, ['Comedy', 'Ecchi']), title(4, ['Romance'])]
  assert.deepEqual(
    pullable(pool).map((media) => media.id),
    [2, 4],
  )
  assert.deepEqual(pullable([title(9, ['Ecchi'])]), [])
})
