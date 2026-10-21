// The lab's own list, kept under anibeam:lab-list, never the real anibeam:list:v1, so a reload
// shows a save surviving and the lab can't touch a list PR 1 saves. It is not PR 1's store, only
// enough of one to try the buttons: one entry per title in the spec's record shape (§3F), a delete
// marker on removal, and the status lines the plan proposes. "Storage full" and "At the cap"
// make the next save fail as the plan describes. Every frame of the lab shares it: another
// frame's change arrives as a storage event.
import { useSyncExternalStore } from 'react'
import { WORDS } from './wording.ts'
import { COPY_FROM, LAB_TITLES, MISSING_ID, POOL } from './pool.ts'

export const KEY = 'anibeam:lab-list'

export type Status = 'SAVED' | 'WANT'
export type Entry = { status: Status; favorite: boolean; updatedAt: number; deleted?: true }
export type List = Record<string, Entry>

function read(): List {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as List) : {}
  } catch {
    return {}
  }
}

let list: List = read()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

addEventListener('storage', (event) => {
  if (event.key !== KEY && event.key !== null) return
  list = read()
  changed()
})

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The list, the same object until it changes. */
export const useList = () => useSyncExternalStore(subscribe, () => list)

/** The title's entry, if it is on the list (not a delete marker). */
export const entryOf = (from: List, id: number) => {
  const entry = from[id]
  return entry && !entry.deleted ? entry : undefined
}

/** The ids on the list, the most recently changed first. */
export const listedIds = (from: List) =>
  Object.entries(from)
    .filter(([, entry]) => !entry.deleted)
    .toSorted(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .map(([id]) => Number(id))

// What a save does (see the lab's Storage switch).
let storage: 'works' | 'full' | 'cap' = 'works'
export const setStorage = (to: typeof storage) => void (storage = to)

/** Writes the list: "kept" when the device wouldn't save it, which keeps it for this visit. */
function write(next: List): 'saved' | 'kept' {
  list = next
  changed()
  if (storage === 'full') return 'kept'
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    return 'saved'
  } catch {
    return 'kept'
  }
}

// Time never goes back for a title, even if the clock does.
const stamp = (before?: Entry) => Math.max(Date.now(), (before?.updatedAt ?? 0) + 1)

/**
 * Sets a title's status, or takes it off the list (null), which leaves a delete marker and clears
 * its heart. Returns what the status line says: only a move, a removal, a failed save or the cap,
 * never a plain press.
 */
export function setStatus(id: number, status: Status | null): string {
  const before = list[id]
  const listed = entryOf(list, id)
  if (status === null) {
    if (!listed) return ''
    const marker: Entry = { ...listed, favorite: false, updatedAt: stamp(before), deleted: true }
    return write({ ...list, [id]: marker }) === 'kept' ? WORDS.kept : WORDS.removed
  }
  if (!listed && storage === 'cap') return WORDS.full
  const entry: Entry = { status, favorite: listed?.favorite ?? false, updatedAt: stamp(before) }
  const said =
    listed && listed.status !== status
      ? status === 'WANT'
        ? WORDS.movedWant
        : WORDS.movedSaved
      : ''
  return write({ ...list, [id]: entry }) === 'kept' ? WORDS.kept : said
}

/** A press on Save or Want to try as a pair (D1 a): the other moves it, the pressed removes it. */
export const press = (id: number, status: Status) =>
  setStatus(id, entryOf(list, id)?.status === status ? null : status)

/**
 * The heart. On a title not on the list it adds it as Saved and Favorite (D2 a), or does nothing
 * (D2 b, where the heart is off until the title is saved).
 */
export function toggleFavorite(id: number, rule: 'adds' | 'waits'): string {
  const before = list[id]
  const listed = entryOf(list, id)
  if (!listed && rule === 'waits') return ''
  if (!listed && storage === 'cap') return WORDS.full
  const entry: Entry = listed
    ? { ...listed, favorite: !listed.favorite, updatedAt: stamp(before) }
    : { status: 'SAVED', favorite: true, updatedAt: stamp(before) }
  return write({ ...list, [id]: entry }) === 'kept' ? WORDS.kept : ''
}

/** Puts back an entry as a new edit, with a fresh updatedAt (Undo). */
export function restore(id: number, entry: Entry) {
  const { deleted: _, ...live } = entry
  return write({ ...list, [id]: { ...live, updatedAt: stamp(list[id]) } }) === 'kept'
    ? WORDS.kept
    : ''
}

/** Writes delete markers for these ids ("Remove them"). */
export function removeAll(ids: number[]) {
  const next = { ...list }
  for (const id of ids) {
    const listed = entryOf(next, id)
    if (listed) next[id] = { ...listed, favorite: false, updatedAt: stamp(next[id]), deleted: true }
  }
  write(next)
}

/** Sets one title's entry outright, or takes it off (the lab's state buttons). */
export function setEntry(id: number, entry: Omit<Entry, 'updatedAt'> | null) {
  if (entry) write({ ...list, [id]: { ...entry, updatedAt: stamp(list[id]) } })
  else setStatus(id, null)
}

/** Adds these ids with this status (Saved unless asked), keeping any already listed. */
export function addAll(ids: number[], status: Status = 'SAVED') {
  const next = { ...list }
  let at = Date.now()
  for (const id of ids)
    if (!entryOf(next, id)) next[id] = { status, favorite: false, updatedAt: at-- }
  write(next)
}

/** Empties the list, markers and all. */
export function reset() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Blocked storage: the list lives in memory, as here.
  }
  list = {}
  changed()
}

/**
 * Twelve titles: the six lab titles and six samples as Saved, three of them Favorites, and three
 * samples as Want to try, as the plan's example tabs read ("Saved 12", "Want to try 3").
 */
export function twelve() {
  const others = POOL.map(({ id }) => id).filter((id) => !LAB_TITLES.includes(id))
  const saved = [...LAB_TITLES, ...others.slice(0, 6)]
  const want = others.slice(6, 9)
  const now = Date.now()
  const next: List = {}
  saved.forEach((id, i) => {
    next[id] = { status: 'SAVED', favorite: i % 2 === 0 && i < 6, updatedAt: now - i * 3_600_000 }
  })
  want.forEach((id, i) => {
    next[id] = { status: 'WANT', favorite: false, updatedAt: now - (i + 12) * 3_600_000 }
  })
  reset()
  write(next)
}

/** Sixty Saved titles: the pool's, then copies (see COPY_FROM), for the over-50 note. */
export function fill60() {
  const ids = [
    ...POOL.map(({ id }) => id),
    ...Array.from({ length: 60 - POOL.length }, (_, i) => COPY_FROM + i),
  ]
  const now = Date.now()
  reset()
  write(
    Object.fromEntries(
      ids.map((id, i) => [
        id,
        { status: 'SAVED', favorite: i % 5 === 0, updatedAt: now - i * 60_000 },
      ]),
    ),
  )
}

/** Stages the missing title as Saved, if it isn't listed. */
export const stageMissing = () => {
  if (!entryOf(list, MISSING_ID)) addAll([MISSING_ID])
}

/** Takes the staged title off again, leaving no trace: the lab put it there. */
export function unstageMissing() {
  if (!(MISSING_ID in list)) return
  const { [MISSING_ID]: staged, ...rest } = list
  void staged
  write(rest)
}
