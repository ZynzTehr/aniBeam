import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Tag } from '../anime/queries.ts'
import type { Stop } from './moods.ts'
import {
  FEW,
  NEED_MORE,
  pullable,
  remember,
  RING,
  type Rollable,
  rollNext,
  WINDOW,
} from './roll.ts'
import { rankMatches, type Sliders } from './score.ts'

const title = (id: number, genres: string[] = []): Rollable => ({ id, genres })
const ids = (titles: readonly Rollable[]) => titles.map(({ id }) => id)
const NOTHING = new Set<number>()

/** A seeded stand-in for Math.random (mulberry32), so a failing seed fails every run. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A machine's run for one seed: a pool of 25 to 150 titles, about 1 in 10 Ecchi, up to a fifth of
 * them on My List, and `rolls` rolls, each remembered in the ring as the page would, with the
 * window on for half the seeds.
 */
function run(seed: number, rolls = 70) {
  const random = seeded(seed)
  const size = 25 + Math.floor(random() * 126)
  const pool = Array.from({ length: size }, (_, i) =>
    title(1000 + i, random() < 0.1 ? ['Comedy', 'Ecchi'] : ['Comedy']),
  )
  const listed = new Set(ids(pool.filter(() => random() < random() * 0.2)))
  const windowed = seed % 2 === 0
  const may = pool.filter((media) => !media.genres.includes('Ecchi') && !listed.has(media.id))
  let ring: number[] = []
  let shown: number | undefined
  const results = []
  for (let i = 0; i < rolls; i++) {
    const before = ring
    const roll = rollNext({ ranked: pool, listed, ring, windowed, random, shown })
    results.push({ ...roll, ring: before, shown })
    if (!roll.media) break
    shown = roll.media.id
    ring = remember(ring, roll.media.id)
  }
  return { seed, size, pool, listed, windowed, may, results }
}
const RUNS = Array.from({ length: 200 }, (_, i) => run(i + 1))

test('the runs cover pools of 25 to 150 titles, with and without the window', () => {
  const sizes = RUNS.map(({ size }) => size)
  assert.ok(Math.min(...sizes) < 35 && Math.max(...sizes) > 140, `pool sizes ${sizes}`)
  assert.ok(
    RUNS.some(({ may }) => may.length <= RING),
    'no run is left with only recent rolls',
  )
  assert.ok(
    RUNS.some(({ listed }) => listed.size > 10),
    'no run has much on My List',
  )
})

test('a roll never gives a title on My List, nor an Ecchi one', () => {
  for (const { seed, results, listed } of RUNS)
    for (const [i, { media }] of results.entries()) {
      assert.ok(media, `seed ${seed}, roll ${i + 1}: nothing came out`)
      assert.ok(!listed.has(media.id), `seed ${seed}, roll ${i + 1}: ${media.id} is on My List`)
      assert.ok(!media.genres.includes('Ecchi'), `seed ${seed}, roll ${i + 1}: Ecchi`)
    }
})

test('no title comes up twice in 30 rolls in a row while another can come up', () => {
  for (const { seed, results, may } of RUNS) {
    const rolled = results.map(({ media }) => media!.id)
    for (const [i, { reason, ring }] of results.entries()) {
      // 30, not RING: the spec's number, which RING must be.
      const last30 = rolled.slice(Math.max(0, i - 30), i)
      const forgotten = last30.filter((id) => !ring.includes(id))
      assert.deepEqual(forgotten, [], `seed ${seed}, roll ${i + 1}: rolled lately, not in the ring`)
      const others = may.filter((media) => !last30.includes(media.id))
      if (others.length) {
        assert.ok(
          !last30.includes(rolled[i]),
          `seed ${seed}, roll ${i + 1}: ${rolled[i]} again, within 30, with ${others.length} unrolled`,
        )
        assert.notEqual(reason, 'repeat', `seed ${seed}, roll ${i + 1}`)
      } else assert.equal(reason, 'repeat', `seed ${seed}, roll ${i + 1}`)
    }
  }
})

test('20 rolls give 20 different titles whenever at least 20 can come up', () => {
  let counted = 0
  for (const { seed, results, may } of RUNS) {
    if (may.length < 20) continue
    counted++
    const first20 = results.slice(0, 20).map(({ media }) => media!.id)
    assert.equal(new Set(first20).size, 20, `seed ${seed}: ${first20}`)
  }
  assert.ok(counted > 150, `only ${counted} runs had 20 titles that could come up`)
})

test('with only recent rolls left, the oldest comes back first, never the one on screen', () => {
  let repeats = 0
  for (const { seed, results, may } of RUNS)
    for (const [i, { media, reason, ring, shown }] of results.entries()) {
      if (reason !== 'repeat') continue
      repeats++
      const byAge = ring.filter((id) => may.some((other) => other.id === id))
      const oldest = byAge.find((id) => id !== shown) ?? byAge[0]
      assert.equal(media!.id, oldest, `seed ${seed}, roll ${i + 1}`)
    }
  assert.ok(repeats > 100, `only ${repeats} repeats`)
})

test('a roll never gives the title already on screen while another can come up', () => {
  for (const { seed, results, may } of RUNS) {
    if (may.length < 2) continue
    for (const [i, { media, shown }] of results.entries())
      assert.notEqual(media!.id, shown, `seed ${seed}, roll ${i + 1}`)
  }
})

test('with the window on, a roll picks among the 12 best that can come up', () => {
  for (const { seed, results, may, windowed } of RUNS) {
    if (!windowed) continue
    for (const [i, { media, reason, ring }] of results.entries()) {
      if (reason === 'repeat') continue
      const best = may.filter((other) => !ring.includes(other.id)).slice(0, WINDOW)
      assert.ok(best.includes(media!), `seed ${seed}, roll ${i + 1}: ${media!.id} is past the 12`)
    }
  }
})

test('without the window, a roll can give any title that can come up', () => {
  const pool = Array.from({ length: 40 }, (_, i) => title(i + 1))
  const draws = [0, 0.5, 0.99].map(
    (draw) => rollNext({ ranked: pool, listed: NOTHING, ring: [], random: () => draw }).media!.id,
  )
  assert.deepEqual(draws, [1, 21, 40])
  const windowed = [0, 0.5, 0.99].map(
    (draw) =>
      rollNext({ ranked: pool, listed: NOTHING, ring: [], windowed: true, random: () => draw })
        .media!.id,
  )
  assert.deepEqual(windowed, [1, 7, 12])
})

test('the reason, the count left and the need for more follow what can come up', () => {
  for (const { seed, results, may } of RUNS)
    for (const [i, { reason, left, needMore, ring }] of results.entries()) {
      const fresh = may.filter((media) => !ring.includes(media.id)).length
      const where = `seed ${seed}, roll ${i + 1}`
      assert.equal(left, fresh, where)
      assert.equal(needMore, fresh < NEED_MORE, where)
      if (reason !== 'repeat') assert.equal(reason, fresh < FEW ? 'few' : 'ok', where)
    }
})

test('20 left to come up are ok and 19 few; 10 left need no more titles and 9 do', () => {
  // The spec's numbers, written out: under 20 is few, and fewer than 10 unseen titles left asks
  // for more (§3C). The check above holds the roll to FEW and NEED_MORE, whatever they are; this
  // one holds them to 20 and 10. Two titles on My List and three among the last rolls are never
  // counted.
  const at = (fresh: number) => {
    const pool = Array.from({ length: fresh + 5 }, (_, i) => title(i + 1))
    const listed = new Set([fresh + 1, fresh + 2])
    const ring = [fresh + 3, fresh + 4, fresh + 5]
    const { reason, left, needMore } = rollNext({ ranked: pool, listed, ring, random: () => 0 })
    return { reason, left, needMore }
  }
  assert.deepEqual(at(20), { reason: 'ok', left: 20, needMore: false })
  assert.deepEqual(at(19), { reason: 'few', left: 19, needMore: false })
  assert.deepEqual(at(10), { reason: 'few', left: 10, needMore: false })
  assert.deepEqual(at(9), { reason: 'few', left: 9, needMore: true })
  assert.deepEqual({ FEW, NEED_MORE }, { FEW: 20, NEED_MORE: 10 })
})

test('with every title on My List or Ecchi, nothing comes out: "empty", and more is needed', () => {
  const pool = [title(1), title(2, ['Ecchi']), title(3)]
  assert.deepEqual(
    rollNext({ ranked: pool, listed: new Set([1, 3]), ring: [], random: Math.random }),
    { media: null, reason: 'empty', left: 0, needMore: true },
  )
  assert.deepEqual(rollNext({ ranked: [], listed: NOTHING, ring: [], random: Math.random }), {
    media: null,
    reason: 'empty',
    left: 0,
    needMore: true,
  })
})

test('one title that can come up comes up every time, as a repeat after the first', () => {
  const pool = [title(1), title(2, ['Ecchi'])]
  const first = rollNext({ ranked: pool, listed: NOTHING, ring: [], random: Math.random })
  assert.deepEqual([first.media?.id, first.reason], [1, 'few'])
  const again = rollNext({
    ranked: pool,
    listed: NOTHING,
    ring: [1],
    random: Math.random,
    shown: 1,
  })
  assert.deepEqual([again.media?.id, again.reason], [1, 'repeat'])
})

test('the ring keeps the last 30 rolls, the newest last, a title rolled again moved to the end', () => {
  let ring: number[] = []
  for (let id = 1; id <= 45; id++) ring = remember(ring, id)
  assert.equal(RING, 30)
  assert.deepEqual(
    ring,
    Array.from({ length: 30 }, (_, i) => i + 16),
  )
  assert.deepEqual(remember(ring, 20), [...ring.filter((id) => id !== 20), 20])
})

test('pullable leaves out Ecchi titles, and keeps the rest in order', () => {
  const pool = [title(1, ['Action']), title(2, ['Comedy', 'Ecchi']), title(3)]
  assert.deepEqual(ids(pullable(pool)), [1, 3])
})

// The recorded titles (see recorded.json's note), for rolls from a ranked pool.
const RECORDED: (Rollable & { tags: Tag[] })[] = JSON.parse(
  readFileSync(new URL('./recorded.json', import.meta.url), 'utf8'),
).titles.map(
  ({ id, genres, tags }: { id: number; genres: string[]; tags: [string, number][] }) => ({
    id,
    genres,
    tags: tags.map(([name, rank]) => ({
      name,
      rank,
      isAdult: false,
      isGeneralSpoiler: false,
      isMediaSpoiler: false,
    })),
  }),
)

test('the count left and the need for more are the same at every slider setting', () => {
  // Moving a slider must never send a request, so what would ask for more can't change with it:
  // it is counted before the window, which only a set slider uses.
  const stops: Stop[] = [-2, -1, 0, 1, 2]
  const settings: Sliders[] = stops.flatMap((energy) =>
    stops.flatMap((tone) => stops.map((complexity) => ({ energy, tone, complexity }))),
  )
  const pool = RECORDED.slice(0, 40)
  const listed = new Set(ids(pool.slice(0, 6)))
  for (const rolled of [0, 12, 25, 30]) {
    const ring = ids(pool.slice(6, 6 + rolled))
    const counts = new Set(
      settings.map((sliders) => {
        const { left, needMore } = rollNext({
          ranked: rankMatches(pool, sliders),
          listed,
          ring,
          windowed: Object.values(sliders).some((stop) => stop !== 0),
          random: () => 0.5,
        })
        return `${left} left, need more ${needMore}`
      }),
    )
    assert.equal(counts.size, 1, `with ${rolled} rolled: ${[...counts].join('; ')}`)
  }
})

// Discover's pull with every slider at no preference: a roll from the page's titles, in their
// order, with no window (see PullMachine).
const POOL = [
  title(1, ['Action']),
  title(2, ['Comedy', 'Slice of Life']),
  title(3, ['Action', 'Drama']),
  title(4, ['Romance']),
  title(5, ['Sports']),
]
/** Discover's pull from `pool`, with what has come up lately and a fixed draw. */
const pull = ({
  ring = [] as number[],
  listed = NOTHING,
  draw = 0,
  shown = undefined as number | undefined,
  pool = POOL,
} = {}) => rollNext({ ranked: pool, listed, ring, random: () => draw, shown }).media?.id ?? null

test('a pull at no preference may give any title, the first to the last', () => {
  assert.deepEqual([pull(), pull({ draw: 0.99 })], [1, 5])
})

test('a pull skips the titles on My List, and with all of them there gives nothing', () => {
  assert.equal(pull({ listed: new Set([1]) }), 2)
  assert.equal(pull({ listed: new Set([1, 2, 3, 4, 5]) }), null)
})

test('once every title has come up, a pull skips the title on screen', () => {
  // Draw 0 would take title 1, the one showing; the oldest of the rest comes back otherwise.
  assert.equal(pull({ ring: [1, 2, 3, 4, 5], shown: 1 }), 2)
  assert.equal(pull({ ring: [5, 1, 2, 3, 4], shown: 4, draw: 0.99 }), 5)
})

test('a machine with a single title pulls it again, even while it is on screen', () => {
  assert.equal(pull({ pool: [title(4)], ring: [4], shown: 4 }), 4)
})

test('a pull skips the title on screen even if it hasn’t come up lately', () => {
  for (const draw of [0, 0.99]) assert.notEqual(pull({ draw, shown: draw ? 5 : 1 }), draw ? 5 : 1)
})

test('an empty pool gives nothing to pull', () => {
  assert.equal(pull({ pool: [] }), null)
})

// Spec §3G: Ecchi stays out of the gacha (browsing and search still show it). Ecchi titles sit at
// both ends of this pool, so draws 0 and 0.99 land on one whenever one is allowed.
const WITH_ECCHI = [
  title(8, ['Comedy', 'Ecchi']),
  title(2, ['Comedy']),
  title(9, ['Comedy', 'Ecchi']),
]
for (const [when, ring] of [
  ['while titles are left', []],
  ['once every title has come up', [2]],
] as [string, number[]][])
  test(`a pull never hands out an Ecchi title ${when}`, () => {
    for (const draw of [0, 0.99]) assert.equal(pull({ pool: WITH_ECCHI, ring, draw }), 2)
  })

test('with only Ecchi titles, there is nothing to pull', () => {
  assert.equal(pull({ pool: [title(9, ['Ecchi'])] }), null)
})
