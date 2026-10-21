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
 * time is a whole number of milliseconds from 0, below 2^53, where whole numbers stop being exact:
 * a change must always be able to come 1 ms after the last one.
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

/** The title's entry while it is on the list: not a delete marker. */
const onList = (list: List, id: number): Entry | undefined =>
  list[id]?.deleted ? undefined : list[id]

const isFull = (list: List) => Object.values(list).filter((entry) => !entry.deleted).length >= CAP

/**
 * `list` with the title's latest change: its new status and heart, or a delete marker. The change
 * is made at `now`, or 1 ms after the title's last change if the clock reads earlier, as when the
 * computer's clock was set back. So a title's changes always come in order, and the last one wins
 * a merge (see rank).
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
  const updatedAt = before === undefined ? now : Math.max(now, before + 1)
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
  const entry = onList(list, id)
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
  setStatusIn(list, id, onList(list, id)?.status === status ? null : status, now)

/**
 * A press on the title's heart: given or taken away while the title is on the list, its status
 * kept. On a title not on the list, it follows HEART_ADDS_AS, unless the list is full.
 */
export function toggleFavoriteIn(list: List, id: number, now: number): Edited {
  const entry = onList(list, id)
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
