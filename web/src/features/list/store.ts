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
