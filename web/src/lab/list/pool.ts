// The titles the lab draws from: the bundled samples and three saved titles they lack (see
// titles.ts), so it asks AniList for nothing. The covers still come from AniList's image server,
// as on the site.
import { titleOf } from '../../features/anime/format.ts'
import type { Media } from '../../features/anime/queries.ts'
import { SAMPLES } from '../../features/anime/samples.ts'
import { EXTRA } from './titles.ts'

export const POOL: Media[] = [...SAMPLES, ...EXTRA]

/** The title lab's six titles (#26): the card's switcher offers these. */
export const LAB_TITLES = [154587, 16498, 1, 1052, 207329, 21]

/** An id staged as missing: AniList's answer would leave it out ("couldn't be shown"). */
export const MISSING_ID = 999999999

/**
 * "Fill 60" needs more titles than the pool's: past it, ids from here on are copies of the pool's
 * titles, marked "(copy)", so the over-50 note can show.
 */
export const COPY_FROM = 990000000

/** The title with this id, a copy for a filler id, or null for the missing id. */
export function titleFor(id: number): Media | null {
  const found = POOL.find((media) => media.id === id)
  if (found) return found
  if (id < COPY_FROM || id === MISSING_ID) return null
  const of = POOL[(id - COPY_FROM) % POOL.length]
  return { ...of, id, title: { ...of.title, english: `${titleOf(of)} (copy)` } }
}
