import { useSyncExternalStore } from 'react'

// The page's address (spec §3.0): / is Discover, and /anime/:id opens that title's card over it.
// Later addresses (/list, /mood) and chat's episode rooms (/anime/:id?ep=N, the query) fit beside
// these: this file reads only the path, and leaves the query and the hash to their owners (sync's
// #r= fragment, in Phase 8, is never read here).

// An AniList id: a whole number from 1, with no leading zero, of at most 9 digits (AniList's ids
// are 6 digits today), so a typed address can't ask for a number past what an Int holds.
const TITLE = /^\/anime\/([1-9]\d{0,8})\/?$/

/** The title an address's path opens: 154587 for /anime/154587 or /anime/154587/, else null. */
export function titleIdFrom(pathname: string): number | null {
  const id = TITLE.exec(pathname)?.[1]
  return id === undefined ? null : Number(id)
}

/** A title's address, which titleIdFrom reads back: /anime/154587 for 154587. */
export const titlePath = (id: number) => `/anime/${id}`

// Back and Forward announce themselves (popstate), but the page's own changes to the address
// don't, so those tell the listeners here.
const listeners = new Set<() => void>()

/**
 * Calls `onChange` each time the address's path may have changed, until the function it returns is
 * called. Made for React's useSyncExternalStore, with location.pathname to read the path.
 */
export function watchPath(onChange: () => void) {
  listeners.add(onChange)
  addEventListener('popstate', onChange)
  return () => {
    listeners.delete(onChange)
    removeEventListener('popstate', onChange)
  }
}

const pathname = () => location.pathname

/** The address's path, kept up to date as it changes. */
export const usePathname = () => useSyncExternalStore(watchPath, pathname)

/**
 * Puts `path` in the address bar in place of the address there now, with no new history entry,
 * and keeps the entry's state (`history.state`) unless given another.
 */
export function replace(path: string, state: unknown = history.state) {
  history.replaceState(state, '', path)
  for (const listener of listeners) listener()
}
