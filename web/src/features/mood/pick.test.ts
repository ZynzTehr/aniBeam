import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Media } from '../anime/queries.ts'
import { pickTitle } from './pick.ts'

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

test('no title repeats until every match has come up once', () => {
  const seen = new Set<number>()
  for (let i = 0; i < pool.length; i++) {
    const pick = pickTitle(pool, [], seen, Math.random)!
    assert.ok(!seen.has(pick.id), `title ${pick.id} came up twice`)
    seen.add(pick.id)
  }
  assert.equal(seen.size, pool.length)
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
