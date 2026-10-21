// The list store (store.ts): the one piece of code that reads and writes My List in the browser's
// localStorage, under anibeam:list:v1 (spec §3F).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from './store.ts'

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
