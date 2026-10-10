import type { Media } from '../anime/queries.ts'

/**
 * The titles that can come out of the machine. Ecchi titles never do (spec §3G keeps them out
 * of the gacha; browsing and search still show them).
 */
export const pullable = (pool: Media[]) => pool.filter((media) => !media.genres.includes('Ecchi'))

/**
 * A random title for a pull, from the pullable ones. It has one of the vibe's genres (any
 * title, for no genres), and it hasn't come up yet this visit until every match has. With no
 * match at all, any pullable title will do. `random` is Math.random, or a stand-in in tests.
 */
export function pickTitle(
  pool: Media[],
  genres: string[],
  seen: Set<number>,
  random: () => number,
): Media | null {
  const titles = pullable(pool)
  const matches = titles.filter(
    (media) => genres.length === 0 || media.genres.some((genre) => genres.includes(genre)),
  )
  const fresh = matches.filter((media) => !seen.has(media.id))
  const from = fresh.length ? fresh : matches.length ? matches : titles
  return from.length ? from[Math.floor(random() * from.length)] : null
}
