// The mood map, spec §3C: the AniList genres and tags at each end of each slider. AniList has no
// mood data, so a title's place on a slider is worked out from these (see score.ts): a genre counts
// 1.0 and a tag its rank / 100, toward the high end or away from it. A name may sit on two sliders
// (Iyashikei, Episodic, Cute Girls Doing Cute Things, Slapstick, Psychological), and counts once on
// each. moodMap.test.ts holds every name to AniList's spelling.
import type { Axis } from './moods.ts'

/** The genres and tags at one end of a slider. */
export type End = { genres: readonly string[]; tags: readonly string[] }

export const MOOD_MAP: Record<Axis, { low: End; high: End }> = {
  energy: {
    // Cozy
    low: {
      genres: ['Slice of Life'],
      tags: [
        'Iyashikei',
        'Cute Girls Doing Cute Things',
        'Food',
        'Camping',
        'Agriculture',
        'Rural',
        'Family Life',
        'Episodic',
      ],
    },
    // High-octane
    high: {
      genres: ['Action', 'Sports', 'Mecha'],
      tags: [
        'Martial Arts',
        'Super Power',
        'Swordplay',
        'Battle Royale',
        'Military',
        'Super Robot',
        'Athletics',
      ],
    },
  },
  tone: {
    // Uplifting
    low: {
      genres: ['Comedy'],
      tags: ['Found Family', 'Coming of Age', 'Iyashikei', 'Parenthood', 'Slapstick'],
    },
    // Dark and tragic
    high: {
      genres: ['Horror', 'Psychological', 'Thriller'],
      tags: [
        'Tragedy',
        'Death Game',
        'Survival',
        'Post-Apocalyptic',
        'Dystopian',
        'Gore',
        'Body Horror',
        'Cosmic Horror',
        'War',
        'Revenge',
      ],
    },
  },
  complexity: {
    // Popcorn
    low: {
      genres: [],
      tags: [
        'Parody',
        'Slapstick',
        'Surreal Comedy',
        'Episodic',
        'Kids',
        'Cute Girls Doing Cute Things',
      ],
    },
    // Cerebral
    high: {
      genres: ['Mystery', 'Psychological', 'Sci-Fi'],
      tags: [
        'Philosophy',
        'Politics',
        'Conspiracy',
        'Time Manipulation',
        'Time Loop',
        'Achronological Order',
        'Dissociative Identities',
        'Detective',
      ],
    },
  },
}

/**
 * Every tag the mood map names, at either end of any slider: what a decade's mood pool keeps of a
 * title's tags beyond those its card shows (see poolQuery in queries.ts), spoilers included, as
 * they count toward the score.
 */
export const MOOD_TAGS: ReadonlySet<string> = new Set(
  Object.values(MOOD_MAP).flatMap(({ low, high }) => [...low.tags, ...high.tags]),
)
