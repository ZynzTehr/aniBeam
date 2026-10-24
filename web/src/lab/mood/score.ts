// The draft scoring that PR 2 lands as features/mood/score.ts: axisRaw, normalise, rankMatches and
// whyOf. Pure functions of a title's genres and tags and the slider stops; nothing here asks
// AniList for anything, so a slider move costs no request. A change the user agrees in the lab (K,
// the weights) moves into PR 2 as one constant.
import type { Media, Tag } from '../../features/anime/queries.ts'
import type { Axis, Stop } from '../../features/mood/moods.ts'
import { MOOD_MAP } from './moodMap.ts'

export const AXIS_KEYS: Axis[] = ['energy', 'tone', 'complexity']

/** The sliders' stops, one per axis; 0 is no preference. */
export type Sliders = Record<Axis, Stop>

export const NO_PREFERENCE: Sliders = { energy: 0, tone: 0, complexity: 0 }

/** How the scores meet the sliders: the tanh squash (A6 a) or the spec's raw distance (A6 b). */
export type Scale = 'tanh' | 'raw'

/** The squash's constant: 2 x tanh(raw / K). */
export const K = 1.5

const spoils = (tag: Tag) => Boolean(tag.isGeneralSpoiler || tag.isMediaSpoiler)

/**
 * One axis's raw score: each high-end genre adds 1.0 and each high-end tag its rank / 100; the low
 * end takes them away. Spoiler tags count (they are never named, see whyOf); adult tags never do.
 */
export function axisRaw(media: Media, axis: Axis) {
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

/** A raw score squeezed onto the sliders' scale, -2 to 2, without cutting it off. */
export const normalise = (raw: number, k = K) => 2 * Math.tanh(raw / k)

/** A raw score as the spec's literal distance reads it: cut off at the scale's ends. */
const clip = (raw: number) => Math.max(-2, Math.min(2, raw))

/** A title's three scores on the sliders' scale. */
export function scoresOf(media: Media, scale: Scale = 'tanh'): Record<Axis, number> {
  const on = scale === 'tanh' ? normalise : clip
  return {
    energy: on(axisRaw(media, 'energy')),
    tone: on(axisRaw(media, 'tone')),
    complexity: on(axisRaw(media, 'complexity')),
  }
}

export const anySet = (sliders: Sliders) => AXIS_KEYS.some((axis) => sliders[axis] !== 0)

export type Ranked<T extends Media = Media> = { media: T; distance: number }

/**
 * The pool ranked by how close each title sits to the sliders. Only the sliders that are set count:
 * one at No preference is skipped, not read as "neutral". With none set, the pool's own order
 * (AniList's popularity) comes back. Ties keep the pool's order.
 */
export function rankMatches<T extends Media>(
  pool: T[],
  sliders: Sliders,
  scale: Scale = 'tanh',
): Ranked<T>[] {
  const set = AXIS_KEYS.filter((axis) => sliders[axis] !== 0)
  const ranked = pool.map((media, index) => {
    const scores = set.length ? scoresOf(media, scale) : null
    const distance = scores
      ? Math.sqrt(set.reduce((sum, axis) => sum + (scores[axis] - sliders[axis]) ** 2, 0))
      : 0
    return { media, distance, index }
  })
  return ranked
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ media, distance }) => ({ media, distance }))
}

/**
 * What the Why line names: the two non-spoiler tags that push hardest toward the set sliders (rank
 * x |stop|), falling back to a genre at that end. Nothing when no slider is set. Spoiler tags may
 * count toward the score but are never named.
 */
export function whyOf(media: Media, sliders: Sliders): string[] {
  const pushes = new Map<string, number>()
  const genres: string[] = []
  for (const axis of AXIS_KEYS) {
    const stop = sliders[axis]
    if (stop === 0) continue
    const end = stop > 0 ? MOOD_MAP[axis].high : MOOD_MAP[axis].low
    for (const tag of media.tags) {
      if (tag.isAdult || spoils(tag) || !end.tags.includes(tag.name)) continue
      const push = ((tag.rank ?? 0) / 100) * Math.abs(stop)
      pushes.set(tag.name, Math.max(pushes.get(tag.name) ?? 0, push))
    }
    for (const genre of media.genres)
      if (end.genres.includes(genre) && !genres.includes(genre)) genres.push(genre)
  }
  const tags = [...pushes].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  return [...tags, ...genres.filter((genre) => !tags.includes(genre))].slice(0, 2)
}

/** Each mapped tag a title has, with its push, for the lab's debug view (spoilers included). */
export function contributions(media: Media) {
  const found: { axis: Axis; name: string; weight: number; spoiler: boolean }[] = []
  for (const axis of AXIS_KEYS) {
    const { low, high } = MOOD_MAP[axis]
    for (const genre of media.genres) {
      if (high.genres.includes(genre)) found.push({ axis, name: genre, weight: 1, spoiler: false })
      if (low.genres.includes(genre)) found.push({ axis, name: genre, weight: -1, spoiler: false })
    }
    for (const tag of media.tags) {
      if (tag.isAdult) continue
      const weight = (tag.rank ?? 0) / 100
      const spoiler = spoils(tag)
      if (high.tags.includes(tag.name)) found.push({ axis, name: tag.name, weight, spoiler })
      if (low.tags.includes(tag.name))
        found.push({ axis, name: tag.name, weight: -weight, spoiler })
    }
  }
  return found
}
