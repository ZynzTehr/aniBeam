import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dropTrailer,
  isOver,
  isTrailer,
  push,
  pushTrailer,
  replace,
  titleIdFrom,
  titlePath,
  watchPath,
} from './route.ts'

test('an address opens a title only at /anime/ and its AniList id, with or without a last slash', () => {
  assert.equal(titleIdFrom('/anime/154587'), 154587)
  assert.equal(titleIdFrom('/anime/154587/'), 154587)
  assert.equal(titleIdFrom('/anime/1'), 1)
  assert.equal(titleIdFrom('/anime/999999999'), 999999999)
  for (const path of [
    '/',
    '/anime',
    '/anime/',
    '/anime/0',
    // A leading zero, or a tenth digit, is no AniList id.
    '/anime/0154587',
    '/anime/1000000000',
    '/anime/154587//',
    '/anime/154587/chat',
    '/anime/-5',
    '/anime/1e5',
    '/anime/%31',
    '/Anime/154587',
    '/list',
    '/x/anime/154587',
  ])
    assert.equal(titleIdFrom(path), null, path)
})

test('a title’s address reads back as its id', () => {
  for (const id of [1, 154587, 999999999]) assert.equal(titleIdFrom(titlePath(id)), id)
  assert.equal(titlePath(154587), '/anime/154587')
})

// A stand-in for the browser's address and history, on globalThis until the test ends, as Node has
// none: replaceState and pushState change the path, as the browser's do (pushState in a new entry),
// and fire no popstate, as the browser's don't. In a browser, window is globalThis, so addEventListener is the window's.
function fakeWindow(t: import('node:test').TestContext, path = '/') {
  const events = new EventTarget()
  const location = { pathname: path, search: '', hash: '' }
  const history = {
    state: null as unknown,
    entries: [path],
    replaceState(state: unknown, _title: string, url: string) {
      const next = new URL(url, `https://ani-beam.vercel.app${location.pathname}`)
      Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash })
      history.state = state
      history.entries[history.entries.length - 1] = next.pathname
    },
    pushState(state: unknown, title: string, url: string) {
      history.entries.push('')
      history.replaceState(state, title, url)
    },
  }
  const page = {
    location,
    history,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  }
  const saved = Object.keys(page).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  t.after(() => {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  for (const [name, value] of Object.entries(page))
    Object.defineProperty(globalThis, name, { configurable: true, value })
  return { location, history, events }
}

test('replacing the address tells those watching it, keeps its state, and adds no history', (t) => {
  const { location, history } = fakeWindow(t, '/anime/154587')
  history.state = { over: '/' }
  const heard: string[] = []
  const stop = watchPath(() => heard.push(location.pathname))
  replace('/')
  assert.deepEqual(heard, ['/'])
  assert.deepEqual(history.state, { over: '/' })
  replace('/anime/1', null)
  assert.equal(history.state, null)
  stop()
  replace('/')
  assert.deepEqual(heard, ['/', '/anime/1'], 'a watcher that stopped hears nothing more')
  assert.deepEqual(history.entries, ['/'], 'replacing added a history entry')
})

test('Back and Forward (popstate) reach those watching the address, until they stop', (t) => {
  const { events } = fakeWindow(t)
  let heard = 0
  const stop = watchPath(() => heard++)
  events.dispatchEvent(new Event('popstate'))
  stop()
  events.dispatchEvent(new Event('popstate'))
  assert.equal(heard, 1)
})

test('pushing an address adds a history entry with its state, and tells those watching it', (t) => {
  const { location, history } = fakeWindow(t, '/')
  const heard: string[] = []
  const stop = watchPath(() => heard.push(location.pathname))
  push('/anime/154587', { over: '/' })
  stop()
  assert.deepEqual(heard, ['/anime/154587'])
  assert.deepEqual(history.state, { over: '/' })
  assert.deepEqual(history.entries, ['/', '/anime/154587'])
})

test('an entry the page pushed over an address says so; any other state does not', () => {
  assert.equal(isOver({ over: '/' }), true)
  for (const state of [null, undefined, {}, { over: 1 }, 'over', { other: '/' }])
    assert.equal(isOver(state), false, JSON.stringify(state))
})

test('Watch trailer adds a history entry at the card’s address, its state kept under the trailer’s mark', (t) => {
  const { location, history } = fakeWindow(t, '/')
  push('/anime/154587', { over: '/' })
  location.search = '?ep=5'
  const heard: string[] = []
  const stop = watchPath(() => heard.push(location.pathname))
  pushTrailer()
  stop()
  assert.deepEqual(history.state, { over: '/', trailer: true })
  assert.ok(isTrailer(history.state) && isOver(history.state))
  assert.deepEqual(history.entries, ['/', '/anime/154587', '/anime/154587'])
  assert.equal(location.search, '?ep=5', 'the query is left as it was')
  assert.deepEqual(heard, ['/anime/154587'])
  // A card opened at its address has no state of its own: the trailer's entry has its mark alone.
  history.state = null
  pushTrailer()
  assert.deepEqual(history.state, { trailer: true })
})

test('only the trailer’s mark says a trailer is open', () => {
  assert.equal(isTrailer({ over: '/', trailer: true }), true)
  for (const state of [null, undefined, {}, { over: '/' }, { trailer: 'yes' }, 'trailer', 1])
    assert.equal(isTrailer(state), false, JSON.stringify(state))
})

test('a card opened at the trailer’s entry takes its mark off, keeping the rest and adding no entry', (t) => {
  const { history } = fakeWindow(t, '/anime/154587')
  history.state = { over: '/', trailer: true }
  dropTrailer()
  assert.deepEqual(history.state, { over: '/' })
  assert.deepEqual(history.entries, ['/anime/154587'])
  // An entry with no mark is left as it is.
  const state = { over: '/' }
  history.state = state
  dropTrailer()
  assert.equal(history.state, state)
})
