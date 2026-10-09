import type { Media } from '../anime/queries.ts'

/**
 * A random title for a pull. It has one of the vibe's genres (any title, for no genres), and
 * it hasn't come up yet this visit until every match has. With no match in the pool at all,
 * any title will do. Ecchi titles never come up (spec §3G keeps them out of the gacha;
 * browsing and search still show them). `random` is Math.random, or a stand-in in tests.
 */
export function pickTitle(
  pool: Media[],
  genres: string[],
  seen: Set<number>,
  random: () => number,
): Media | null {
  const pullable = pool.filter((media) => !media.genres.includes('Ecchi'))
  const matches = pullable.filter(
    (media) => genres.length === 0 || media.genres.some((genre) => genres.includes(genre)),
  )
  const fresh = matches.filter((media) => !seen.has(media.id))
  const from = fresh.length ? fresh : matches.length ? matches : pullable
  return from.length ? from[Math.floor(random() * from.length)] : null
}
