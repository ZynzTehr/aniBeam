import type { UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'
import { AniListError } from '../../lib/anilist.ts'
import type { Era, Media } from './queries.ts'

// Spec §3H: when a section can't reach AniList, it shows bundled sample titles instead of an empty
// page. A class on one school Wi-Fi shares one rate limit, so a demo is when that's most likely.

/**
 * Wraps `load` so every caller shares one run of it, kept once it succeeds. A failed run is
 * dropped, so the next call tries again.
 */
export function sharedLoad<T>(load: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined
  return () =>
    (running ??= load().catch((error: unknown) => {
      running = undefined
      throw error
    }))
}

/**
 * The sample titles (samples.ts). They are a file of their own, loaded the first time a section
 * can't reach AniList, so a visit where AniList answers never downloads them.
 */
export const loadSamples = sharedLoad(() => import('./samples.ts').then((module) => module.SAMPLES))

/**
 * The samples from `era`. Media has no start date, so a sample's year is its season year, read as
 * January 1st and compared with the era's dates, which exclude both bounds as AniList does (see
 * ERAS). Upcoming has no dates, and every sample has finished airing, so it gets none.
 */
export function samplesFor(samples: Media[], era: Era): Media[] {
  const { from, to } = era.variables
  if (typeof from !== 'number' || typeof to !== 'number') return []
  return samples.filter((media) => {
    const start = (media.seasonYear ?? 0) * 10000 + 101
    return start > from && start < to
  })
}

/**
 * True for the failures spec §3H names, when this browser can't get titles from AniList for now: a
 * failed connection (fetch's TypeError, which is also how an answer without CORS headers arrives),
 * a refusal (403) or the rate limit (429). A server error or a bad request gets no samples.
 */
export const outOfReach = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof AniListError && (error.status === 403 || error.status === 429))

/**
 * Whether a section shows the sample titles in place of its own (spec §3H): from the moment it has
 * no titles and a try can't reach AniList (outOfReach) until it gets titles. Placeholder titles,
 * such as the last decade's while a new one loads, count as titles. It holds through the tries
 * that follow, because TanStack clears a list's failure when it tries again: Try again would
 * otherwise take the samples away while anilist() waits out its pause, for up to a minute.
 * Discover's sections use it, and My List (see ListPage).
 */
export function useOutage(query: UseQueryResult<Media[]>) {
  const [latched, setLatched] = useState(false)
  const outage =
    query.data === undefined && (latched || outOfReach(query.failureReason ?? query.error))
  // React lets a component update its own state as it renders: it renders again at once.
  if (outage !== latched) setLatched(outage)
  return outage
}
