// What comes out of a machine: the next title for a pull or a roll, from a list already in order
// (best match first, or the page's own order), the titles on My List and the visit's last rolls.
// It doesn't import score.ts, so Discover's pull doesn't bring the scoring along into every visit,
// and it asks AniList for nothing.
import type { Media } from '../anime/queries.ts'

/** How many rolls the ring remembers: none of them comes back until this many others have. */
export const RING = 30

/** While a slider is set, a roll picks among this many of the best matches (A12). */
export const WINDOW = 12

/** Fewer titles than this left to come up: "few". */
export const FEW = 20

/**
 * Fewer than this left to come up, none included: the machine is worth filling with more titles,
 * on Discover the decade's pool first and then its page 3, once (A12).
 */
export const NEED_MORE = 10

/** What a roll reads of a title. */
export type Rollable = Pick<Media, 'id' | 'genres'>

/**
 * The titles that may come out of a machine at all. Ecchi titles never do (spec §3G keeps them out
 * of the gacha and the mood pool; browsing and search still show them).
 */
export const pullable = <T extends Rollable>(pool: readonly T[]) =>
  pool.filter((media) => !media.genres.includes('Ecchi'))

export type Roll<T> = {
  /** The title rolled, or null when every title that may come out is on My List. */
  media: T | null
  /**
   * ok; few, under FEW left to come up; repeat, none left but the last rolls, so the oldest of them
   * comes back; empty, every title that may come out is on My List.
   */
  reason: 'ok' | 'few' | 'repeat' | 'empty'
  /** How many titles can still come up, counted before any slider's window. */
  left: number
  /** Whether so few are left, none included, that more titles are worth asking for (NEED_MORE). */
  needMore: boolean
}

/**
 * The next roll from `ranked`. The titles that can come up are the pullable ones, minus My List
 * (`listed`), minus the last rolls (`ring`, the oldest first). While a slider is set (`windowed`) a
 * roll picks at random among the WINDOW best of them, otherwise among all of them, and never
 * `shown`, the title on screen, while another can come up. With only the last rolls left, the
 * oldest of them comes back. `random` is Math.random, or a stand-in in tests.
 *
 * `left` and `needMore` are counted before the window, so moving a slider, which only reorders
 * `ranked`, can never change them.
 */
export function rollNext<T extends Rollable>({
  ranked,
  listed,
  ring,
  windowed = false,
  random,
  shown,
}: {
  ranked: readonly T[]
  listed: ReadonlySet<number>
  ring: readonly number[]
  windowed?: boolean
  random: () => number
  shown?: number
}): Roll<T> {
  const unlisted = pullable(ranked).filter((media) => !listed.has(media.id))
  if (!unlisted.length) return { media: null, reason: 'empty', left: 0, needMore: true }
  const recent = new Set(ring)
  const fresh = unlisted.filter((media) => !recent.has(media.id))
  const left = fresh.length
  const needMore = left < NEED_MORE
  // Once a roll lands on the title already showing, the lever looks like it did nothing.
  const notShown = (list: T[]) => {
    const others = list.filter((media) => media.id !== shown)
    return others.length ? others : list
  }
  if (!fresh.length) {
    // Every title left is among the last rolls, oldest first: the oldest comes back.
    const byAge = ring.flatMap((id) => unlisted.filter((media) => media.id === id))
    return { media: notShown(byAge)[0], reason: 'repeat', left, needMore }
  }
  const from = notShown(windowed ? fresh.slice(0, WINDOW) : fresh)
  const media = from[Math.min(Math.floor(random() * from.length), from.length - 1)]
  return { media, reason: left < FEW ? 'few' : 'ok', left, needMore }
}

/**
 * Discover's pull: a roll (see rollNext) from `titles`, in the page's order, among those with one
 * of the vibe's `genres` (all of them, for Any vibe), or among them all once none of those can
 * come up, as when none has the genres or all that do are on My List.
 */
export function pullNext<T extends Rollable>({
  titles,
  genres,
  ...roll
}: {
  titles: readonly T[]
  genres: readonly string[]
  listed: ReadonlySet<number>
  ring: readonly number[]
  random: () => number
  shown?: number
}): T | null {
  const matches = genres.length
    ? titles.filter((media) => media.genres.some((genre) => genres.includes(genre)))
    : titles
  return rollNext({ ranked: matches, ...roll }).media ?? rollNext({ ranked: titles, ...roll }).media
}

/** The ring after a roll of `id`: it moves to the newest end, and any past RING drop off. */
export const remember = (ring: readonly number[], id: number) =>
  [...ring.filter((other) => other !== id), id].slice(-RING)
