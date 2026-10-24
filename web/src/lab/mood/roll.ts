// The draft roll rule that PR 2 lands as features/mood/roll.ts. It takes a list already ranked (see
// score.ts, which it does not import, so Discover's pull would not bring the scoring along), with
// My List's ids, the ring of the last rolls and a random source, and picks the next title. It asks
// AniList for nothing.
import type { Media } from '../../features/anime/queries.ts'

/** How many rolls the ring remembers: none of them comes back until this many others have. */
export const RING = 30

/** How many of the best matches a roll picks among while a slider is set (A12). */
export const WINDOW = 12

/** Fewer titles than this left to come up: the "few" line. */
export const FEW = 20

/** Fewer than this: page 3 of the era would be fetched, once (A12, spec §3C). */
export const PAGE_3 = 10

/** How a roll picks (A12): among the top 12, always the next best, or the whole pool by match. */
export type Picking = 'top12' | 'next' | 'weighted'

/** What happens when only recent rolls are left (A12). */
export type WhenSpent = 'repeat' | 'empty'

/** Sequels (B2): allowed, skipped while another season came up lately, or first seasons only. */
export type Sequels = 'allowed' | 'skip' | 'first'

export type RollTitle = Media & { sequel?: boolean; franchise?: string }

export type Roll<T extends RollTitle> = {
  media: T | null
  /** ok; few (under 20 left); repeat (only recent rolls left); empty (all left are listed). */
  reason: 'ok' | 'few' | 'repeat' | 'empty'
  /** How many can still come up, counted before any slider window. */
  left: number
  /** Whether page 3 should be fetched now, counted before any slider window. */
  page3: boolean
}

/**
 * The next roll from `ranked` (best match first). The titles that can come up are the ranked ones
 * minus My List (`listed`), minus Ecchi, minus the last rolls (`ring`, oldest first). It picks
 * among the top WINDOW while a slider is set, otherwise among all of them, and never `shown`, the
 * title on screen, while another can come up. When only recent rolls are left, the oldest comes
 * back first (or nothing, with `whenSpent` 'empty').
 */
export function rollNext<T extends RollTitle>({
  ranked,
  distances,
  listed,
  ring,
  sliderSet,
  random,
  shown,
  picking = 'top12',
  whenSpent = 'repeat',
  sequels = 'allowed',
}: {
  ranked: T[]
  /** Each title's distance to the sliders, for weighted picking. */
  distances?: Map<number, number>
  listed: Set<number>
  ring: number[]
  sliderSet: boolean
  random: () => number
  shown?: number
  picking?: Picking
  whenSpent?: WhenSpent
  sequels?: Sequels
}): Roll<T> {
  const recent = new Set(ring)
  const franchisesLately = new Set(
    ring.map((id) => ranked.find((media) => media.id === id)?.franchise).filter(Boolean),
  )
  const unlisted = ranked.filter(
    (media) =>
      !listed.has(media.id) &&
      !media.genres.includes('Ecchi') &&
      !(sequels === 'first' && media.sequel),
  )
  if (!unlisted.length) return { media: null, reason: 'empty', left: 0, page3: false }
  const fresh = unlisted.filter(
    (media) =>
      !recent.has(media.id) &&
      !(sequels === 'skip' && media.franchise && franchisesLately.has(media.franchise)),
  )
  // Counted here, before the slider window, so a slider move can never change it.
  const left = fresh.length
  const page3 = left < PAGE_3
  if (!fresh.length) {
    if (whenSpent === 'empty') return { media: null, reason: 'empty', left, page3 }
    const oldest = ring.map((id) => unlisted.find((media) => media.id === id)).find(Boolean)
    const others = unlisted.filter((media) => media.id !== shown)
    return { media: oldest ?? others[0] ?? unlisted[0], reason: 'repeat', left, page3 }
  }
  const reason = left < FEW ? 'few' : 'ok'
  const others = (list: T[]) => {
    const without = list.filter((media) => media.id !== shown)
    return without.length ? without : list
  }
  if (picking === 'next') return { media: others(fresh)[0], reason, left, page3 }
  if (picking === 'weighted' && sliderSet) {
    const from = others(fresh)
    const weights = from.map((media) => 1 / (1 + (distances?.get(media.id) ?? 0)) ** 2)
    let at = random() * weights.reduce((sum, weight) => sum + weight, 0)
    const index = weights.findIndex((weight) => (at -= weight) < 0)
    return { media: from[index === -1 ? from.length - 1 : index], reason, left, page3 }
  }
  const from = others(sliderSet ? fresh.slice(0, WINDOW) : fresh)
  return { media: from[Math.floor(random() * from.length)], reason, left, page3 }
}

/** The ring after a roll of `id`: it moves to the newest end, and the oldest past RING drop off. */
export const remember = (ring: number[], id: number) =>
  [...ring.filter((other) => other !== id), id].slice(-RING)
