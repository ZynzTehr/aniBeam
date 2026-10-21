import { useSyncExternalStore } from 'react'

// My List (spec §3F): the titles the visitor saves, kept in this browser's localStorage under one
// key, anibeam:list:v1, as { [AniList id]: { status, favorite, updatedAt, deleted? } }. It holds
// ids and statuses only, never a title's details (spec §5), and nothing else writes it.

/** Saved, or Want to try: a title on the list has one of the two. */
export type Status = 'SAVED' | 'WANT'

/**
 * A title's place on the list: its status, its heart, and when it last changed, in milliseconds
 * since 1970. A title taken off the list keeps an entry marked `deleted`, the delete marker, so a
 * copy of the list from before can't bring it back.
 */
export type Entry = { status: Status; favorite: boolean; updatedAt: number; deleted?: true }

/** The list: each title's entry, by its AniList id as text ("154587"), as JSON keeps it. */
export type List = Record<string, Entry>

// An AniList id as route.ts reads one from an address: a whole number from 1, with no leading zero,
// of at most 9 digits.
const ID = /^[1-9]\d{0,8}$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The entry `value` holds, with only the fields an entry has, or null if any of them is wrong. The
 * time is a whole number of milliseconds from 0 to 2^53 - 1 (LAST), past which whole numbers stop
 * being exact.
 */
function entryOf(value: unknown): Entry | null {
  if (!isObject(value)) return null
  const { status, favorite, updatedAt, deleted } = value
  if (status !== 'SAVED' && status !== 'WANT') return null
  if (typeof favorite !== 'boolean') return null
  if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0)
    return null
  if ('deleted' in value && deleted !== true) return null
  return deleted === true
    ? { status, favorite, updatedAt, deleted: true }
    : { status, favorite, updatedAt }
}

/**
 * The list a saved copy (`raw`, as localStorage gives it, null if there is none) holds, entry by
 * entry: an entry with a wrong id or field is left out on its own, and the rest kept, so one bad
 * entry never costs the visitor their list. Nothing saved, broken JSON, or anything but an object
 * of entries gives an empty list. It never throws.
 */
export function parse(raw: string | null): List {
  let saved: unknown
  try {
    saved = JSON.parse(raw ?? '{}')
  } catch {
    return {}
  }
  const list: List = {}
  if (!isObject(saved)) return list
  for (const [id, value] of Object.entries(saved)) {
    const entry = entryOf(value)
    if (ID.test(id) && entry) list[id] = entry
  }
  return list
}

// Which of two entries for one title wins: the later change; and, made at the same moment, the
// delete marker, then Saved, then the heart. An entry has these four fields and no others (see
// parse), so this orders every two that differ, and two copies merged settle on one list whichever
// is merged into which: two tabs, or later two devices (spec §6), always agree.
const rank = ({ updatedAt, deleted, status, favorite }: Entry) => [
  updatedAt,
  deleted ? 1 : 0,
  status === 'SAVED' ? 1 : 0,
  favorite ? 1 : 0,
]

/** The entry that wins of two for one title (see rank): `a` when they are the same. */
function winner(a: Entry, b: Entry) {
  const [first, second] = [rank(a), rank(b)]
  const i = first.findIndex((value, at) => value !== second[at])
  return i === -1 || first[i] > second[i] ? a : b
}

/**
 * Two copies of the list as one, title by title: a title in one copy only keeps its entry, and one
 * in both the entry that wins (see rank), delete markers included, so a copy from before a title
 * was taken off can't bring it back. The same two copies give the same list in either order, merged
 * in any grouping and merged again. Neither copy is changed, and an entry that wins is the very
 * object it was in `a`, or else in `b`.
 */
export function merge(a: List, b: List): List {
  const list = { ...a }
  for (const [id, entry] of Object.entries(b))
    list[id] = Object.hasOwn(a, id) ? winner(a[id], entry) : entry
  return list
}

/** The most titles the list holds (spec §3F's soft cap). Delete markers don't count. */
export const CAP = 2000

/**
 * What an edit did: added a title, moved it to the other status, removed it, gave it the heart or
 * took the heart away; nothing, as when the title was already so; or nothing because the list is
 * full (see CAP).
 */
export type Change = 'added' | 'moved' | 'removed' | 'favorited' | 'unfavorited' | 'none' | 'full'

/** An edit's outcome: the list as it now is, and what changed (`list` itself when nothing did). */
export type Edited = { list: List; change: Change }

// The heart pressed on a title not on the list puts it on, Saved, with the heart (the plan's D2,
// option a). Null would leave such a press doing nothing, for a heart shown disabled until then.
const HEART_ADDS_AS: Status | null = 'SAVED'

/** The title's entry while it is on the list, or undefined: a delete marker reads as none. */
export const entryIn = (list: List, id: number): Entry | undefined =>
  list[id]?.deleted ? undefined : list[id]

// The last time an entry can have: 2^53 - 1 ms, some 285,000 years on, which only a list edited by
// hand holds.
const LAST = Number.MAX_SAFE_INTEGER

const isFull = (list: List) => Object.values(list).filter((entry) => !entry.deleted).length >= CAP

/**
 * `list` with the title's latest change: its new status and heart, or a delete marker. The change
 * is made at `now`, or 1 ms after the title's last change if the clock reads earlier, as when the
 * computer's clock was set back. So a title's changes always come in order, and the last one wins
 * a merge (see rank). After a change made at LAST, the next is made at LAST too, as a later time
 * would be dropped the next time the list is read (see parse).
 */
function written(
  list: List,
  id: number,
  now: number,
  status: Status,
  favorite: boolean,
  deleted = false,
): List {
  const before = list[id]?.updatedAt
  const updatedAt = before === undefined ? now : Math.max(now, Math.min(before + 1, LAST))
  const entry: Entry = deleted
    ? { status, favorite, updatedAt, deleted: true }
    : { status, favorite, updatedAt }
  return { ...list, [id]: entry }
}

/**
 * Puts the title on the list with `status`, moving it if it has the other one and keeping its
 * heart, or takes it off with null: a delete marker, which takes its heart away too. Adding to a
 * full list changes nothing. Nor does an id that isn't an AniList id (see ID): a saved copy would
 * lose it.
 */
export function setStatusIn(list: List, id: number, status: Status | null, now: number): Edited {
  const entry = entryIn(list, id)
  if (!ID.test(String(id))) return { list, change: 'none' }
  if (status === null) {
    if (!entry) return { list, change: 'none' }
    return { list: written(list, id, now, entry.status, false, true), change: 'removed' }
  }
  if (entry?.status === status) return { list, change: 'none' }
  if (!entry && isFull(list)) return { list, change: 'full' }
  return {
    list: written(list, id, now, status, entry?.favorite ?? false),
    change: entry ? 'moved' : 'added',
  }
}

/**
 * A press on the title's Saved or Want to try button (`status`): the button already pressed takes
 * the title off the list, and the other moves it there, or puts it on.
 */
export const pressStatusIn = (list: List, id: number, status: Status, now: number) =>
  setStatusIn(list, id, entryIn(list, id)?.status === status ? null : status, now)

/**
 * A press on the title's heart: given or taken away while the title is on the list, its status
 * kept. On a title not on the list, it follows HEART_ADDS_AS, unless the list is full.
 */
export function toggleFavoriteIn(list: List, id: number, now: number): Edited {
  const entry = entryIn(list, id)
  if (!ID.test(String(id))) return { list, change: 'none' }
  if (entry)
    return {
      list: written(list, id, now, entry.status, !entry.favorite),
      change: entry.favorite ? 'unfavorited' : 'favorited',
    }
  if (!HEART_ADDS_AS) return { list, change: 'none' }
  if (isFull(list)) return { list, change: 'full' }
  return { list: written(list, id, now, HEART_ADDS_AS, true), change: 'added' }
}

/** Where the list is saved: localStorage, under this key alone. */
export const KEY = 'anibeam:list:v1'

// The saved copy of AniList's answers (queryClient.ts), which can grow to about 4.3 MB of the
// about 5 MB a site has. When storage is full, the list wins: the answers are removed, as they can
// be asked for again, and the visitor's own list can't.
const CACHE = 'anibeam:cache'

/** localStorage, as far as the list uses it. */
export type ListStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * What an edit did (see Change), and whether the list it left is saved on this device: false when
 * storage refused it, so it lasts for this visit only. An edit that changed nothing has nothing to
 * save, and says true.
 */
export type Outcome = { change: Change; saved: boolean }

// The error a browser throws when a site's storage is full: QuotaExceededError, or Firefox's own
// name for it in older versions.
const isQuota = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')

const sameEntry = (a: Entry, b: Entry) =>
  a === b ||
  (a.status === b.status &&
    a.favorite === b.favorite &&
    a.updatedAt === b.updatedAt &&
    a.deleted === b.deleted)

/** Whether two lists hold the same entries. */
function sameList(a: List, b: List) {
  const ids = Object.keys(a)
  return (
    ids.length === Object.keys(b).length &&
    ids.every((id) => Object.hasOwn(b, id) && sameEntry(a[id], b[id]))
  )
}

// What tells a tab that the saved list may have changed without it: another tab's write (storage,
// with the list's key, or none after a clear); the browser bringing the page back from its cache on
// Back or Forward (pageshow, persisted), with the list as it was when the page was left; and the
// visitor coming back to the tab (visibilitychange), in case a storage event was missed.
const EVENTS = ['storage', 'pageshow', 'visibilitychange']

/**
 * A list kept in `storage`, which is undefined when the browser blocks it (as some private modes
 * do), and then kept for the visit only. Several, given one storage, act as several tabs do.
 * `events` is where the page's events arrive (the window), and `now` the clock, which tests can
 * set.
 */
export function createListStore({
  storage,
  events,
  now = Date.now,
}: {
  storage: ListStorage | undefined
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
  now?: () => number
}) {
  // The list as this tab has it, read from storage when first asked for. It stays the very same
  // object until an entry in it changes, as React's useSyncExternalStore needs: a new one each time
  // it is read would draw the page again, and again, without end.
  let list: List | undefined
  const listeners = new Set<() => void>()

  // Makes `next` the list, if it differs from it, and tells those listening.
  function publish(next: List) {
    if (list && sameList(next, list)) return
    list = next
    for (const listener of listeners) listener()
  }

  // The saved list (empty when none is), or undefined when storage is blocked or can't be read.
  function stored() {
    try {
      return storage && parse(storage.getItem(KEY))
    } catch {
      return undefined
    }
  }

  // Saves `next`, and returns whether it was saved. When storage is full, the saved AniList
  // answers go, and the list is tried once more. Each edit tries that again, as TanStack may save
  // its answers again in between (see queryClient.ts).
  function save(next: List) {
    if (!storage) return false
    const json = JSON.stringify(next)
    try {
      storage.setItem(KEY, json)
      return true
    } catch (error) {
      if (!isQuota(error)) return false
    }
    try {
      storage.removeItem(CACHE)
      storage.setItem(KEY, json)
      return true
    } catch {
      return false
    }
  }

  // Each edit reads the saved list and merges it with this tab's before it changes anything, then
  // saves the result: another tab's edit since this one last read is kept, never written over.
  // Should two tabs' edits cross even so, the storage event that follows puts back what was lost
  // (see onEvent).
  function edit(change: (list: List, now: number) => Edited): Outcome {
    const saved = stored()
    const edited = change(saved ? merge(getSnapshot(), saved) : getSnapshot(), now())
    publish(edited.list)
    const unchanged = edited.change === 'none' || edited.change === 'full'
    return { change: edited.change, saved: unchanged || save(edited.list) }
  }

  /** The list as this tab has it: the very same object until it changes. */
  const getSnapshot = () => (list ??= stored() ?? {})

  // Reads the saved list again, and merges it with this tab's; and with `write`, saves the result
  // if the saved list lacks any of it.
  function refresh(write = false) {
    const saved = stored()
    if (!saved) return
    const merged = merge(getSnapshot(), saved)
    publish(merged)
    if (write && !sameList(merged, saved)) save(merged)
  }

  // One listener for the events above, however many are listening to the list. Two tabs' read,
  // merge and write can cross, as a browser's copy of storage in each tab can lag another's write
  // for a moment: one tab then writes over the other's edit. So after another tab writes the list,
  // this one saves its own edits again if the saved list lacks them, or one kept for the visit when
  // storage was full. It writes only what is missing, so two tabs settle after a write each. After
  // a clear, or the list's key removed, it waits for this tab's next edit, so the clear stands
  // until then.
  function onEvent(event: Event) {
    const { key, newValue } = event as StorageEvent
    if (event.type === 'storage' && key !== KEY && key !== null) return
    if (event.type === 'pageshow' && !(event as PageTransitionEvent).persisted) return
    refresh(event.type === 'storage' && key === KEY && newValue !== null)
  }

  /**
   * The list as saved now, for code outside React: read from storage again first while nothing
   * listens, as no event keeps it up to date then (see subscribe).
   */
  function read() {
    if (listeners.size === 0) refresh()
    return getSnapshot()
  }

  /**
   * Calls `onChange` each time the list changes, in this tab or another, until the function it
   * returns is called. Made for React's useSyncExternalStore, with getSnapshot. The first to listen
   * starts the one listener for the page's events, and reads the saved list again, as another tab
   * may have changed it while none was; the last to stop stops it. So React subscribing twice, as
   * it does in development, still adds one.
   */
  function subscribe(onChange: () => void) {
    listeners.add(onChange)
    if (listeners.size === 1) {
      for (const type of EVENTS) events?.addEventListener(type, onEvent)
      refresh()
    }
    return () => {
      if (listeners.delete(onChange) && listeners.size === 0)
        for (const type of EVENTS) events?.removeEventListener(type, onEvent)
    }
  }

  return {
    getSnapshot,
    subscribe,
    read,
    /** Puts the title on the list with `status`, or takes it off with null (see setStatusIn). */
    setStatus: (id: number, status: Status | null) =>
      edit((list, now) => setStatusIn(list, id, status, now)),
    /** A press on the title's Saved or Want to try button (see pressStatusIn). */
    pressStatus: (id: number, status: Status) =>
      edit((list, now) => pressStatusIn(list, id, status, now)),
    /** A press on the title's heart (see toggleFavoriteIn). */
    toggleFavorite: (id: number) => edit((list, now) => toggleFavoriteIn(list, id, now)),
  }
}

// A browser can block a site's storage altogether ("block all site data"): reading localStorage
// then throws, and the list lasts for the visit.
function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** The visitor's list, in this browser's localStorage. */
export const { getSnapshot, subscribe, read, setStatus, pressStatus, toggleFavorite } =
  createListStore({
    storage: browserStorage(),
    events: typeof window === 'undefined' ? undefined : window,
  })

/** The title's entry while it is on the list (see entryIn), kept up to date as it changes. */
export const useEntry = (id: number) =>
  useSyncExternalStore(subscribe, () => entryIn(getSnapshot(), id))

// Each list's ids, worked out once (see listedIn).
const idsOf = new WeakMap<List, number[]>()

/**
 * The ids of the titles on `list`, the most lately changed first (the order the plan recommends
 * for D8, "Recently changed"): the very same array each time for the same list.
 */
export function listedIn(list: List) {
  let ids = idsOf.get(list)
  if (!ids) {
    ids = Object.keys(list)
      .filter((id) => !list[id].deleted)
      .sort((a, b) => list[b].updatedAt - list[a].updatedAt || Number(b) - Number(a))
      .map(Number)
    idsOf.set(list, ids)
  }
  return ids
}

/**
 * The ids of the titles on the visitor's list as saved now (see listedIn and read), for code
 * outside React: the same array until it changes.
 */
export const listedIds = () => listedIn(read())

/** The ids of the titles on the visitor's list (see listedIn), kept up to date as it changes. */
export const useListIds = () => useSyncExternalStore(subscribe, () => listedIn(getSnapshot()))
