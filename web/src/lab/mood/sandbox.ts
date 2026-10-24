// What keeps the lab apart from the visitor's own data, and counts what it asks AniList for.
//
// The list: the lab draws the site's own My List controls and store (ListControls, store.ts), but
// in each of its pages the store's key, anibeam:list:v1, is read and written as anibeam:lab-list,
// so the visitor's own list is never read or touched. main.tsx leaves the lab's pages without the
// list's preload, so nothing reads the list before this file runs (it is the first the lab
// imports). A change one lab page writes reaches the others as a storage event under the lab's
// key, which this hands on to the store under its own.
//
// The counter: every fetch to AniList's API from a lab page is counted, and any other request to it
// the browser reports. The lab makes none: its titles are the recordings in pool.ts. Covers still
// load from AniList's image server, as on the site; those are images, not API requests.
import { useSyncExternalStore } from 'react'
import { KEY } from '../../features/list/store.ts'

export const LAB_KEY = 'anibeam:lab-list'

const swap = (key: string) => (key === KEY ? LAB_KEY : key)
const storage = Storage.prototype
const { getItem, setItem, removeItem } = storage
storage.getItem = function (this: Storage, key: string) {
  return getItem.call(this, swap(String(key)))
}
storage.setItem = function (this: Storage, key: string, value: string) {
  setItem.call(this, swap(String(key)), value)
}
storage.removeItem = function (this: Storage, key: string) {
  removeItem.call(this, swap(String(key)))
}
addEventListener('storage', (event) => {
  if (event.key !== LAB_KEY) return
  dispatchEvent(
    new StorageEvent('storage', {
      key: KEY,
      oldValue: event.oldValue,
      newValue: event.newValue,
      storageArea: event.storageArea,
    }),
  )
})

// ---------- The request counter ----------

const isApi = (url: string) => {
  try {
    const { hostname, pathname } = new URL(url, location.href)
    return (
      hostname === 'graphql.anilist.co' ||
      (/anilist\.co$/.test(hostname) && /^\/api/.test(pathname))
    )
  } catch {
    return false
  }
}

let requests = 0
const listeners = new Set<() => void>()
const counted = () => listeners.forEach((listener) => listener())

const send = window.fetch
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (isApi(url)) {
    requests++
    counted()
  }
  return send(input, init)
}
// Anything else the browser fetched from the API (not through fetch): none is expected either.
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as PerformanceResourceTiming[])
      if (entry.initiatorType !== 'fetch' && isApi(entry.name)) {
        requests++
        counted()
      }
  }).observe({ type: 'resource', buffered: true })
} catch {
  // A browser without resource timing: fetch is still counted.
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The AniList API requests this page has made, kept up to date. */
export const useRequests = () => useSyncExternalStore(subscribe, () => requests)
