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

// The last argument is the title on screen. A pull that lands on it again looks like the lever
// did nothing.
test('once every match has come up, a pull skips the title on screen', () => {
  // Both Action titles have come up: whichever one is showing, the other comes next. Draw 0
  // would take title 1 and 0.99 title 3, the one showing each time.
  assert.equal(pickTitle(pool, ['Action'], new Set([1, 3]), () => 0, 1)?.id, 3)
  assert.equal(pickTitle(pool, ['Action'], new Set([1, 3]), () => 0.99, 3)?.id, 1)
})

test('a vibe with a single match pulls it again, even while it is on screen', () => {
  // Skipping title 4, the only Romance title, would leave nothing to pull.
  assert.equal(pickTitle(pool, ['Romance'], new Set([4]), () => 0, 4)?.id, 4)
})

test('with no match for the vibe, a pull skips the title on screen too', () => {
  // No title is Mecha, so a pull draws from the whole pool. Draw 0 would take title 1 and 0.99
  // title 5, the one showing each time.
  assert.equal(pickTitle(pool, ['Mecha'], new Set([1]), () => 0, 1)?.id, 2)
  assert.equal(pickTitle(pool, ['Mecha'], new Set([5]), () => 0.99, 5)?.id, 4)
})

test('an empty pool gives nothing to pull', () => {
  assert.equal(pickTitle([], ['Action'], new Set(), Math.random), null)
})

// Spec §3G: Ecchi stays out of the gacha (browse and search still show it). Ecchi titles sit
// at both ends of this pool. Draw 0 takes the first candidate and 0.99 the last, so both land
// on an Ecchi title whenever one is allowed.
const withEcchi = [
  title(8, ['Comedy', 'Ecchi']),
  title(2, ['Comedy']),
  title(9, ['Comedy', 'Ecchi']),
]
// [when, vibe genres, titles already pulled]
const ecchiCases: [string, string[], number[]][] = [
  ['for a vibe it matches', ['Comedy'], []],
  ['for any vibe', [], []],
  ['when nothing matches the vibe', ['Mecha'], []],
  ['once every match has come up', ['Comedy'], [2]],
]
for (const [when, genres, pulled] of ecchiCases) {
  test(`a pull never hands out an Ecchi title ${when}`, () => {
    for (const draw of [0, 0.99])
      assert.equal(pickTitle(withEcchi, genres, new Set(pulled), () => draw)?.id, 2, `draw ${draw}`)
  })
}

test('with only Ecchi titles, there is nothing to pull', () => {
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
