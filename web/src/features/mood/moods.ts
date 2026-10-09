/** The pull machine's vibes, each a set of AniList genres. A title matches if it has any of them. */
export const MOODS = {
  any: { label: 'Any vibe', genres: [] as string[] },
  cozy: { label: 'Cozy', genres: ['Slice of Life', 'Comedy'] },
  hype: { label: 'Hype', genres: ['Action', 'Sports', 'Mecha'] },
  cerebral: { label: 'Mind-bending', genres: ['Mystery', 'Psychological', 'Sci-Fi'] },
  tears: { label: 'Tearjerker', genres: ['Drama', 'Romance'] },
}

export type Mood = keyof typeof MOODS
