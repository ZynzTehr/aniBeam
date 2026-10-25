// How a title meets the mood sliders (spec §3C): its place on each slider, worked out from its
// genres and tags (axisRaw). A pure function of what a title already carries, so a slider move
// asks AniList for nothing.
import type { Media } from '../anime/queries.ts'
import { MOOD_MAP } from './moodMap.ts'
import type { Axis } from './moods.ts'

/** What scoring reads of a title. */
export type Scored = Pick<Media, 'genres' | 'tags'>

/**
 * A title's raw score on one slider: each genre at its high end adds 1.0 and each tag there its
 * rank / 100, and the low end's take as much away. Spoiler tags count, as they say what the title
 * is like (Tragedy is always one), though they are never named; adult tags never do.
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
