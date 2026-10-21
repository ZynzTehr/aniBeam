// A title's tags as the card shows them (spec §3G): adult tags never, spoiler tags apart, behind
// "Show spoiler tags", and of each the top few by rank.

/** What the card needs to know of each of AniList's tags; AniList may leave any of it null. */
export type TagFlags = {
  rank: number | null
  isAdult: boolean | null
  isGeneralSpoiler: boolean | null
  isMediaSpoiler: boolean | null
}

/** How many of each kind the card shows: the top 8, the user's pick in the title lab (#26). */
export const TAG_CAP = 8

/**
 * Drops adult tags, puts a tag that spoils this title, or any title it is on (either flag),
 * with the spoilers, and keeps the `cap` highest ranks of each. Equal ranks keep AniList's order.
 */
export function tagsOf<Tag extends TagFlags>(
  tags: readonly Tag[] | null | undefined,
  cap = TAG_CAP,
) {
  const safe = (tags ?? [])
    .filter((tag) => !tag.isAdult)
    .toSorted((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
  const spoils = (tag: Tag) => Boolean(tag.isGeneralSpoiler || tag.isMediaSpoiler)
  return {
    shown: safe.filter((tag) => !spoils(tag)).slice(0, cap),
    spoilers: safe.filter(spoils).slice(0, cap),
  }
}
