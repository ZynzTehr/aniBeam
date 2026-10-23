import { useSyncExternalStore } from 'react'

// The page's address (spec §3.0): / is Discover, /list is My List, and /anime/:id opens that
// title's card over the page. Later addresses (/mood) and chat's episode rooms (/anime/:id?ep=N,
// the query) fit beside these: this file reads only the path, and leaves the query and the hash to
// their owners (sync's #r= fragment, in Phase 8, is never read here).

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

/** Whether an address's path is My List's: /list, or /list/. */
export const isListPath = (pathname: string) => /^\/list\/?$/.test(pathname)

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

/**
 * Whether a history entry's state says the page pushed it, over the address it was opened from
 * (see push): Back then returns there.
 */
export const isOver = (state: unknown): state is { over: string } =>
  typeof (state as { over?: unknown } | null)?.over === 'string'

/**
 * The path of the page an address shows: with a title's card open at `pathname`, the page under
 * it, the address the card was opened over, which its history entry's `state` keeps with its query
 * (see isOver), after a reload there too, or / under a card opened at its address; with no card,
 * `pathname`.
 */
export const pageBeneath = (pathname: string, state: unknown) =>
  titleIdFrom(pathname) === null ? pathname : isOver(state) ? state.over.replace(/\?.*/, '') : '/'

/**
 * Puts `path` in the address bar as a new history entry, with `state` (history.state), so Back
 * goes to the address there now; and tells those watching, as pushState fires no popstate.
 */
export function push(path: string, state: unknown) {
  history.pushState(state, '', path)
  for (const listener of listeners) listener()
}

// This page load's own mark, which the trailer entries it pushes carry (see pushTrailer): a mark
// from another load, as after a reload or in a tab the browser brought back, was left by a press
// nobody made in this one.
const LOAD = Math.random().toString(36).slice(2)

/**
 * Whether a history entry's state says a title's trailer was open over its card: the page pushed
 * it as "Watch trailer" was pressed (see pushTrailer), in this page load or an earlier one, so
 * Back from it closes the trailer alone.
 */
export const isTrailer = (state: unknown) =>
  typeof (state as { trailer?: unknown } | null)?.trailer === 'string'

/**
 * Whether a history entry's state says this page load pushed it for a trailer (see pushTrailer):
 * Forward back to it then plays the trailer again, as a press in this load put it there.
 */
export const pushedTrailer = (state: unknown) =>
  (state as { trailer?: unknown } | null)?.trailer === LOAD

/**
 * Puts a title's trailer over its card as a new history entry, at the card's own address and with
 * the card's state kept under the trailer's mark, this page load's own, so Back returns to the
 * card's entry.
 */
export function pushTrailer() {
  push(`${location.pathname}${location.search}`, {
    ...(history.state as object | null),
    trailer: LOAD,
  })
}

/**
 * Takes the trailer's mark off the history entry the page is at, keeping the rest of its state and
 * adding no entry, and goes Back to the card's own entry, just before it at the same address: for a
 * card opened at an entry the trailer was open at, as after a reload there, which opens without its
 * trailer, as only a press loads YouTube (spec §5), and for Forward to one this page load didn't
 * push (see pushedTrailer). Left there, the card would have two entries, so Back after its trailer
 * played again would land on the other, the card still open. The mark goes first, so the entry,
 * now ahead, opens no trailer by Forward, nor if Back has nowhere to go.
 */
export function dropTrailer() {
  if (!isTrailer(history.state)) return
  const state = { ...(history.state as object) } as { trailer?: string }
  delete state.trailer
  replace(`${location.pathname}${location.search}${location.hash}`, state)
  history.back()
}
