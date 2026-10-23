// Which of the list's titles My List shows (view.ts): a tab, Saved or Want to try, and Favorites
// only, read from the page's address and written back to it (the plan's D9), and the titles each
// holds, in the list's own order.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { List } from './store.ts'
import { countsIn, inView, viewOf, viewPath, type View } from './view.ts'

const T = Date.UTC(2026, 9, 22, 12)

test('the address’s query says the view, and anything else reads as Saved, all of it', () => {
  const cases: [string, View][] = [
    ['', { status: 'SAVED', favorites: false }],
    ['?tab=want', { status: 'WANT', favorites: false }],
    ['?fav=1', { status: 'SAVED', favorites: true }],
    ['?tab=want&fav=1', { status: 'WANT', favorites: true }],
    ['?fav=1&tab=want', { status: 'WANT', favorites: true }],
    ['?tab=saved', { status: 'SAVED', favorites: false }],
    ['?tab=WANT&fav=true', { status: 'SAVED', favorites: false }],
    ['?ep=2', { status: 'SAVED', favorites: false }],
  ]
  for (const [search, view] of cases) assert.deepEqual(viewOf(search), view, search)
})

test('each view has one address, which reads back as that view', () => {
  const paths = [
    [{ status: 'SAVED', favorites: false }, '/list'],
    [{ status: 'WANT', favorites: false }, '/list?tab=want'],
    [{ status: 'SAVED', favorites: true }, '/list?fav=1'],
    [{ status: 'WANT', favorites: true }, '/list?tab=want&fav=1'],
  ] as const
  for (const [view, path] of paths) {
    assert.equal(viewPath(view), path)
    assert.deepEqual(viewOf(path.slice('/list'.length)), view, path)
  }
})

const list: List = {
  '1': { status: 'SAVED', favorite: true, updatedAt: T },
  '21': { status: 'WANT', favorite: false, updatedAt: T + 1 },
  '30': { status: 'SAVED', favorite: false, updatedAt: T + 2 },
  '47': { status: 'WANT', favorite: true, updatedAt: T + 3 },
  '164': { status: 'SAVED', favorite: true, updatedAt: T + 4 },
  '339': { status: 'SAVED', favorite: true, updatedAt: T + 5, deleted: true },
}

test('a view holds the titles of its tab, only the favorites with the filter, in the order given', () => {
  // As the page took them, which needn't be the list's order now.
  const ids = [30, 1, 339, 47, 164, 21, 572]
  assert.deepEqual(inView(list, ids, { status: 'SAVED', favorites: false }), [30, 1, 164])
  assert.deepEqual(inView(list, ids, { status: 'SAVED', favorites: true }), [1, 164])
  assert.deepEqual(inView(list, ids, { status: 'WANT', favorites: false }), [47, 21])
  assert.deepEqual(inView(list, ids, { status: 'WANT', favorites: true }), [47])
  assert.deepEqual(inView({}, ids, { status: 'SAVED', favorites: false }), [])
})

test('each tab counts the titles on the list with its status, delete markers left out', () => {
  assert.deepEqual(countsIn(list), { SAVED: 3, WANT: 2 })
  assert.deepEqual(countsIn({}), { SAVED: 0, WANT: 0 })
})
