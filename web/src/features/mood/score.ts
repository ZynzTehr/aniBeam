// How a title meets the mood sliders (spec §3C): its place on each slider, worked out from its
// genres and tags (axisRaw, normalise), the pool ranked by how close each title sits to the sliders
// (rankMatches), and the Why line's names (whyOf). Pure functions of what a title already carries,
// so a slider move asks AniList for nothing.
import type { Media, Tag } from '../anime/queries.ts'
import { MOOD_MAP } from './moodMap.ts'
import type { Axis, Stop } from './moods.ts'

export const AXIS_KEYS: readonly Axis[] = ['energy', 'tone', 'complexity']

/** The sliders' stops, one for each slider; 0 is no preference. */
export type Sliders = Record<Axis, Stop>

/** What scoring reads of a title. */
export type Scored = Pick<Media, 'genres' | 'tags'>

const spoils = (tag: Tag) => Boolean(tag.isGeneralSpoiler || tag.isMediaSpoiler)

/**
 * A title's raw score on one slider: each genre at its high end adds 1.0 and each tag there its
 * rank / 100, and the low end's take as much away. Spoiler tags count, as they say what the title
 * is like (Tragedy is always one), though they are never named (see whyOf); adult tags never do.
 */
export function axisRaw(media: Scored, axis: Axis) {
  const { low, high } = MOOD_MAP[axis]
  let raw = 0
  for (const genre of media.genres) {
    if (high.genres.includes(genre)) raw += 1
    if (low.genres.includes(genre)) raw -= 1
  }
  for (const tag of media.tags) {
    if (tag.isAdult) continue
    const weight = (tag.rank ?? 0) / 100
    if (high.tags.includes(tag.name)) raw += weight
    if (low.tags.includes(tag.name)) raw -= weight
  }
  return raw
}

/**
 * The tanh squash's constant (the user's pick in the Mood lab, A6): small enough that one strong
 * genre or tag moves a title well along the slider, large enough that titles with many keep
 * apart near its ends.
 */
export const K = 1.5

/**
 * A raw score on the sliders' scale, -2 to 2: squeezed toward the ends without being cut off, so
 * the titles past a slider's end don't all tie there (44 of the lab's titles did at Very
 * high-octane, cut off at 2).
 */
export const normalise = (raw: number) => 2 * Math.tanh(raw / K)

/**
 * `pool` ranked by how close each title sits to the sliders, the closest first. Only the sliders
 * that are set count: one at No preference is left out, not read as a wish for the middle. With
 * none set the pool's own order comes back, and titles equally close keep it too: AniList's
 * popularity, for the pool.
 */
export function rankMatches<T extends Scored>(pool: readonly T[], sliders: Sliders): T[] {
  const set = AXIS_KEYS.filter((axis) => sliders[axis] !== 0)
  if (!set.length) return [...pool]
  return pool
    .map((media, index) => ({
      media,
      index,
      distance: Math.hypot(...set.map((axis) => normalise(axisRaw(media, axis)) - sliders[axis])),
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ media }) => media)
}

/**
 * The names for a title's Why line: the two tags that push it hardest toward the sliders that are
 * set (a tag's rank times how far its slider is from the middle), then a genre at a set slider's
 * end if there is room. Never a spoiler tag, nor an adult one, though spoilers count toward the
 * score, and never a tag that adds nothing (rank 0 or none). Nothing when no slider is set, and
 * nothing for a title that has nothing at their ends.
 */
export function whyOf(media: Scored, sliders: Sliders): string[] {
  const set = AXIS_KEYS.filter((axis) => sliders[axis] !== 0).map((axis) => ({
    far: Math.abs(sliders[axis]),
    end: sliders[axis] > 0 ? MOOD_MAP[axis].high : MOOD_MAP[axis].low,
  }))
  // Each tag once, for its hardest push if it sits at the set end of two sliders. The title's own
  // order of its tags, AniList's, is what equal pushes keep, whichever sliders they come from.
  const tags = media.tags
    .filter((tag) => !tag.isAdult && !spoils(tag))
    .map((tag) => ({
      name: tag.name,
      push: Math.max(
        0,
        ...set.map(({ far, end }) =>
          end.tags.includes(tag.name) ? ((tag.rank ?? 0) / 100) * far : 0,
        ),
      ),
    }))
    .filter(({ push }) => push > 0)
    .sort((a, b) => b.push - a.push)
    .map(({ name }) => name)
  const genres: string[] = []
  for (const { end } of set)
    for (const genre of media.genres)
      if (end.genres.includes(genre) && !genres.includes(genre)) genres.push(genre)
  return [...tags, ...genres].slice(0, 2)
}
