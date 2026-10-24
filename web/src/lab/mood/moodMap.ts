// The draft mood map that PR 2 lands as features/mood/moodMap.ts: spec §3C's genres and tags at
// each end of each axis. A genre counts 1.0, a tag its rank / 100 (see score.ts). A name may sit on
// two axes (Iyashikei, Episodic, Cute Girls Doing Cute Things), and counts once on each.
import type { Axis } from '../../features/mood/moods.ts'

export type End = { genres: string[]; tags: string[] }

export const MOOD_MAP: Record<Axis, { low: End; high: End }> = {
  energy: {
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
    low: {
      genres: ['Comedy'],
      tags: ['Found Family', 'Coming of Age', 'Iyashikei', 'Parenthood', 'Slapstick'],
    },
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
