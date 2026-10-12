// A browser can block a site's storage altogether ("block all site data"): reading localStorage or
// sessionStorage then throws. queryClient.ts picks the saved cache's storage as it loads, so it
// must not throw then, or the page is blank. In every other unit test it falls back only because
// Node has no window, so a fallback that reads globalThis.localStorage, which is blocked too,
// passes them all.
import { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('when the browser blocks storage, the page still loads, and saving and restoring never throw', async (t) => {
  // In a browser, window is globalThis, so blocked storage throws however it is read: as
  // window.localStorage, globalThis.localStorage or just localStorage. These globals go back as
  // they were when the test ends.
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
