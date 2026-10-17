import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replace, titleIdFrom, titlePath, watchPath } from './route.ts'

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
// none: replaceState changes the path, as the browser's does, and fires no popstate, as the
// browser's doesn't. In a browser, window is globalThis, so addEventListener is the window's.
function fakeWindow(t: import('node:test').TestContext, path = '/') {
  const events = new EventTarget()
  const location = { pathname: path, search: '', hash: '' }
  const history = {
    state: null as unknown,
    replaceState(state: unknown, _title: string, url: string) {
      const next = new URL(url, `https://ani-beam.vercel.app${location.pathname}`)
      Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash })
      history.state = state
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
