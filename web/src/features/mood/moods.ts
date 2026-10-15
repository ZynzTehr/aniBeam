/** The pull machine's vibes, each a set of AniList genres. A title matches if it has any of them. */
export const MOODS = {
  any: { label: 'Any vibe', genres: [] as string[] },
  cozy: { label: 'Cozy', genres: ['Slice of Life', 'Comedy'] },
  hype: { label: 'Hype', genres: ['Action', 'Sports', 'Mecha'] },
  cerebral: { label: 'Mind-bending', genres: ['Mystery', 'Psychological', 'Sci-Fi'] },
  tears: { label: 'Tearjerker', genres: ['Drama', 'Romance'] },
}

export type Mood = keyof typeof MOODS

/**
 * The mood sliders' axes (spec §3C), each a native range from -2 to 2. Each stop has a word, which
 * the slider shows and a screen reader hears; the middle one, 0, is no preference. `ends` label
 * the track's ends. The user chose these words on 2026-10-15.
 */
export const AXES = {
  energy: {
    label: 'Energy',
    ends: ['Cozy', 'High-octane'],
    words: ['Very cozy', 'Cozy', 'No preference', 'High-octane', 'Very high-octane'],
  },
  tone: {
    label: 'Tone',
    ends: ['Uplifting', 'Dark & tragic'],
    words: ['Very uplifting', 'Uplifting', 'No preference', 'Dark', 'Very dark'],
  },
  complexity: {
    label: 'Complexity',
    ends: ['Popcorn', 'Cerebral'],
    words: ['Pure popcorn', 'Popcorn', 'No preference', 'Cerebral', 'Very cerebral'],
  },
} as const

export type Axis = keyof typeof AXES

/** A slider's stop: -2 and 2 are its ends, 0 no preference. */
export type Stop = -2 | -1 | 0 | 1 | 2

/** The word for a stop on an axis, such as "Very cozy" for energy at -2. */
export const wordOf = (axis: Axis, stop: Stop) => AXES[axis].words[stop + 2]
