// The list store (store.ts): the one piece of code that reads and writes My List in the browser's
// localStorage, under anibeam:list:v1 (spec §3F).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { merge, parse, type Entry, type List, type Status } from './store.ts'

const T = Date.UTC(2026, 9, 21, 12)

test('a saved list comes back as it was written', () => {
  const list = {
    '1': { status: 'SAVED', favorite: false, updatedAt: T },
    '21': { status: 'WANT', favorite: true, updatedAt: T + 1 },
    '154587': { status: 'SAVED', favorite: false, updatedAt: T + 2, deleted: true },
    '999999999': { status: 'WANT', favorite: false, updatedAt: 0 },
  }
  assert.deepEqual(parse(JSON.stringify(list)), list, 'the list read back')
})

test('one bad entry is dropped on its own, and the good ones beside it are kept', () => {
  const good = { status: 'SAVED', favorite: true, updatedAt: T }
  const list = parse(
    JSON.stringify({
      '1': good,
      // Ids as route.ts reads them: 1 to 9 digits, with no leading zero.
      '0': good,
      '021': good,
      '1000000000': good,
      '-5': good,
      '1e5': good,
      abc: good,
      ['__proto__']: good,
      // Each field, wrong in one way.
      '2': { ...good, status: 'COMPLETED' },
      '3': { ...good, status: 'saved' },
      '4': { favorite: true, updatedAt: T },
      '5': { ...good, favorite: 'yes' },
      '6': { ...good, favorite: 1 },
      '7': { ...good, updatedAt: '1760000000000' },
      '8': { ...good, updatedAt: null },
      '9': { ...good, updatedAt: -1 },
      '10': { ...good, updatedAt: T + 0.5 },
      '11': { ...good, updatedAt: 2 ** 53 },
      '12': { ...good, deleted: false },
      '13': { ...good, deleted: 'true' },
      '14': { ...good, deleted: null },
      '15': null,
      '16': 'SAVED',
      '17': [good],
      '18': good,
    }),
  )
  assert.deepEqual(list, { '1': good, '18': good }, 'only the two good entries are kept')
})

test('a field the list never writes is left out, and the entry kept', () => {
  // Only ids and statuses are kept (spec §5): a title's name, say, never comes back.
  assert.deepEqual(
    parse(
      JSON.stringify({
        '21': { status: 'WANT', favorite: false, updatedAt: T, title: 'One Piece', note: 1 },
      }),
    ),
    { '21': { status: 'WANT', favorite: false, updatedAt: T } },
    'the entry, with only the fields an entry has',
  )
})

test('nothing saved, broken JSON or a list of the wrong shape gives an empty list, never an error', () => {
  for (const raw of [
    null,
    '',
    '{',
    '{"1": {"status": "SAVED",',
    'undefined',
    'null',
    'true',
    '42',
    '"SAVED"',
    '[]',
    '[{"status": "SAVED", "favorite": false, "updatedAt": 1}]',
  ])
    assert.deepEqual(parse(raw), {}, `reading ${raw}`)
})

const saved = (updatedAt: number, favorite = false): Entry => ({
  status: 'SAVED',
  favorite,
  updatedAt,
})
const want = (updatedAt: number, favorite = false): Entry => ({
  status: 'WANT',
  favorite,
  updatedAt,
})
const removed = (updatedAt: number, status: Status = 'SAVED'): Entry => ({
  status,
  favorite: false,
  updatedAt,
  deleted: true,
})

// Random numbers from a seed, the same each run (mulberry32), so a failure can be run again.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A random list over a few ids and a few moments, so that copies share titles and tie often.
function randomList(random: () => number): List {
  const list: List = {}
  for (let id = 1; id <= 6; id++) {
    if (random() < 0.3) continue
    const updatedAt = T + Math.floor(random() * 3)
    const status = random() < 0.5 ? 'SAVED' : 'WANT'
    list[id] =
      random() < 0.3
        ? { status, favorite: random() < 0.5, updatedAt, deleted: true }
        : { status, favorite: random() < 0.5, updatedAt }
  }
  return list
}

test('two copies merge to the same list in either order, in any grouping, and when merged again', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = seeded(seed)
    const [a, b, c] = [randomList(random), randomList(random), randomList(random)]
    const copies = JSON.stringify([a, b, c])
    const ab = merge(a, b)
    assert.deepEqual(ab, merge(b, a), `seed ${seed}: in either order`)
    assert.deepEqual(merge(ab, c), merge(a, merge(b, c)), `seed ${seed}: in any grouping`)
    assert.deepEqual(merge(a, a), a, `seed ${seed}: with itself`)
    assert.deepEqual(merge(ab, b), ab, `seed ${seed}: merged again`)
    assert.equal(JSON.stringify([a, b, c]), copies, `seed ${seed}: a copy was changed`)
  }
})

test('the later change to a title wins, and a title in one copy only is kept', () => {
  const merged = merge(
    { '1': saved(T), '2': want(T + 5), '3': saved(T) },
    { '1': want(T + 1, true), '2': saved(T + 4), '4': want(T) },
  )
  assert.deepEqual(merged, {
    '1': want(T + 1, true),
    '2': want(T + 5),
    '3': saved(T),
    '4': want(T),
  })
})

test('made at the same moment, a delete marker wins, then Saved, then the heart', () => {
  const ties: [winner: Entry, loser: Entry][] = [
    [removed(T), saved(T, true)],
    [removed(T, 'WANT'), saved(T)],
    [removed(T, 'SAVED'), removed(T, 'WANT')],
    [saved(T), want(T, true)],
    [saved(T, true), saved(T)],
    [want(T, true), want(T)],
  ]
  for (const [wins, loses] of ties) {
    const name = `${JSON.stringify(wins)} over ${JSON.stringify(loses)}`
    assert.deepEqual(merge({ '1': wins }, { '1': loses }), { '1': wins }, name)
    assert.deepEqual(merge({ '1': loses }, { '1': wins }), { '1': wins }, name)
  }
})

test("an older copy can't bring back a removed title, and delete markers are kept", () => {
  // Removed in this tab; another tab, or a copy from before, still has it.
  const here = { '1': removed(T + 10), '2': saved(T) }
  const older = { '1': saved(T + 9, true), '3': removed(T) }
  for (const merged of [merge(here, older), merge(older, here)])
    assert.deepEqual(merged, { '1': removed(T + 10), '2': saved(T), '3': removed(T) })
  // Saved again after the removal, it comes back.
  assert.deepEqual(merge(here, { '1': want(T + 11) }), { '1': want(T + 11), '2': saved(T) })
})
