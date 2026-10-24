// The lab's titles as the pages use them: pool.ts's rows unpacked into Media, and the eras they
// fall in. The recordings carry no start date or status, so a title's era is its season's year;
// one with no year shows only under "Any era", and Upcoming holds those from 2027 on.
import type { Media } from '../../features/anime/queries.ts'
import { ROWS } from './pool.ts'

export type LabTitle = Media & { sequel: boolean; franchise: string }

export const TITLES: LabTitle[] = ROWS.map(({ tags, ...row }) => ({
  ...row,
  tags: tags.map(([name, rank, flags]) => ({
    name,
    rank,
    isGeneralSpoiler: Boolean(flags & 1),
    isMediaSpoiler: Boolean(flags & 2),
    isAdult: Boolean(flags & 4),
  })),
}))

/** The era chips: Discover's eight, and A13 (b)'s "Any era". */
export const LAB_ERAS = [
  { id: 'pre-1970', label: 'Pre-1970' },
  { id: '1970s', label: '1970s' },
  { id: '1980s', label: '1980s' },
  { id: '1990s', label: '1990s' },
  { id: '2000s', label: '2000s' },
  { id: '2010s', label: '2010s' },
  { id: '2020s', label: '2020s' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'any', label: 'Any era' },
] as const

export type EraId = (typeof LAB_ERAS)[number]['id']

/** The year from which the lab treats a title as not yet released. */
const UPCOMING_FROM = 2027

/** The titles in an era, in the pool's order. "Any era" leaves out the unreleased ones. */
export function titlesIn(era: EraId): LabTitle[] {
  return TITLES.filter(({ seasonYear: year }) => {
    if (era === 'any') return year === null || year < UPCOMING_FROM
    if (year === null) return false
    if (era === 'upcoming') return year >= UPCOMING_FROM
    if (year >= UPCOMING_FROM) return false
    if (era === 'pre-1970') return year < 1970
    return Math.floor(year / 10) * 10 === Number(era.slice(0, 4))
  })
}

/** "the 1990s", "before 1970", "upcoming" or "any era", for the heading and the lines. */
export function eraWords(era: EraId) {
  if (era === 'pre-1970') return 'before 1970'
  if (era === 'upcoming') return 'upcoming'
  if (era === 'any') return 'any era'
  return `the ${era}`
}
