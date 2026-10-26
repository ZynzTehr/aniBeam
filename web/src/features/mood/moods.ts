import type { Era } from '../anime/queries.ts'

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

/**
 * The machine's matches' heading while every slider is at no preference (the user's pick, D3), for
 * the decade its titles come from, such as "Most popular in the 1990s"; with none, "Most popular".
 */
export const popularHeading = (era: Era | null) =>
  !era
    ? 'Most popular'
    : era.id === 'upcoming'
      ? 'Most popular upcoming titles'
      : `Most popular ${era.id === 'pre-1970' ? 'before 1970' : `in the ${era.label}`}`

/**
 * The machine's line while AniList can't be reached, over `count` sample titles that can come out:
 * one is one title, and with none the line says only that (the hint says the rest).
 */
export const samplesLine = (count: number) =>
  `AniList can’t be reached.${count ? ` Pulling from ${count} sample ${count === 1 ? 'title' : 'titles'}.` : ''}`
