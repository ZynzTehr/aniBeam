/** A title's rarity, by its AniList score: never by luck. */
export function rarityOf(score: number | null) {
  if (score === null) return { key: 'mystery', label: 'Mystery', stars: '?', sfx: '!?' }
  if (score >= 85) return { key: 'ssr', label: 'SSR', stars: '★★★', sfx: 'SSR!!' }
  if (score >= 75) return { key: 'sr', label: 'SR', stars: '★★', sfx: 'SR!' }
  return { key: 'r', label: 'R', stars: '★', sfx: 'R' }
}
