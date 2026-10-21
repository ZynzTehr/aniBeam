// A browser can block a site's storage altogether ("block all site data"): reading localStorage or
// sessionStorage then throws. queryClient.ts picks the saved cache's storage as it loads, and the
// list store (features/list/store.ts) its own, so neither must throw then, or the page is blank. In
// every other unit test they fall back only because Node has no window, so a fallback that reads
// globalThis.localStorage, which is blocked too, passes them all.
import { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

/**
 * Blocks storage for the rest of the test, as such a browser does. In a browser, window is
 * globalThis, so blocked storage throws however it is read: as window.localStorage,
 * globalThis.localStorage or just localStorage. These globals go back as they were when the test
 * ends.
 */
function blockStorage(t: TestContext) {
  const globals = ['window', 'localStorage', 'sessionStorage']
  const before = globals.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  t.after(() => {
    for (const [name, descriptor] of before)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  for (const name of ['localStorage', 'sessionStorage'])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new DOMException(
          `Failed to read the '${name}' property from 'Window': Access is denied for this document.`,
          'SecurityError',
        )
      },
    })
}

test('when the browser blocks storage, the page still loads, and saving and restoring never throw', async (t) => {
  blockStorage(t)
  // A fresh copy of queryClient.ts: the query string makes it a module of its own, so Node runs it
  // again, this time in the window above.
  const loading = import(new URL('./queryClient.ts?storage-blocked', import.meta.url).href)
  await assert.doesNotReject(
    loading,
    'with storage blocked, queryClient.ts threw as it loaded: the page would be blank',
  )
  const { persistOptions } = (await loading) as typeof import('./queryClient.ts')
  const client = new QueryClient()
  client.setQueryData(['trending'], [{ id: 1 }])
  await assert.doesNotReject(
    persistQueryClientSave({ ...persistOptions, queryClient: client }),
    'with storage blocked, saving the cache threw',
  )
  await assert.doesNotReject(
    persistQueryClientRestore({ ...persistOptions, queryClient: new QueryClient() }),
    'with storage blocked, restoring the saved cache threw',
  )
})

test('when the browser blocks storage, My List still works for the visit, and nothing throws', async (t) => {
  blockStorage(t)
  // A fresh copy of the list store, as above.
  const loading = import(new URL('../features/list/store.ts?storage-blocked', import.meta.url).href)
  await assert.doesNotReject(
    loading,
    'with storage blocked, the list store threw as it loaded: the page would be blank',
  )
  const store = (await loading) as typeof import('../features/list/store.ts')
  assert.deepEqual(store.getSnapshot(), {}, 'the list, with nothing to read it from')
  assert.deepEqual(store.pressStatus(154587, 'SAVED'), { change: 'added', saved: false })
  assert.deepEqual(store.toggleFavorite(154587), { change: 'favorited', saved: false })
  assert.equal(store.getSnapshot()['154587'].favorite, true, 'the heart, kept for the visit')
})
