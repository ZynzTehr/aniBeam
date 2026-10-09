import { AniListError } from '../lib/anilist.ts'

const FAILED =
  'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.'
const STALE =
  'AniList isn’t responding right now, so these titles may be out of date. It’s not something you did.'

/** The parts of a TanStack Query result the status line depends on. */
export type QueryStatus = {
  data: unknown[] | undefined
  error: Error | null
  failureReason: Error | null
  isFetching: boolean
  isPaused: boolean
  dataUpdatedAt: number
}

/**
 * One line saying what the list is doing. Waiting states come first, so a retry
 * never reads as "Loading…" or "No titles found.". `rateLimited` is true while
 * anilist() holds requests back.
 */
export function statusText(q: QueryStatus, rateLimited: boolean): string {
  // TanStack holds queries while the browser reports being offline.
  if (q.isPaused) return 'Offline: waiting for a connection.'
  if (q.isFetching) {
    if (q.failureReason instanceof AniListError && q.failureReason.status === 429)
      return 'AniList is busy right now. It’s not something you did. Trying again within a minute.'
    if (q.failureReason instanceof TypeError)
      return 'AniList isn’t responding right now. It’s not something you did. Trying again in a minute.'
    if (rateLimited)
      return 'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.'
  }
  // Errors are worded for visitors: AniList's outage is not their fault.
  if (!q.data) return q.error ? FAILED : 'Loading…'
  if (q.error && !q.isFetching) return STALE
  if (q.data.length === 0) return 'No titles found.'
  const fetchedAt = new Date(q.dataUpdatedAt).toLocaleTimeString()
  return `${q.data.length} titles, fetched at ${fetchedAt}${q.isFetching ? ' (refreshing…)' : ''}`
}

/**
 * The status line a page section shows, or null while its titles are on screen and nothing is
 * wrong (a normal background refresh stays quiet).
 */
export function noteFor(q: QueryStatus, rateLimited: boolean): string | null {
  const held = q.isFetching && (rateLimited || q.failureReason !== null)
  const fine = q.data !== undefined && q.data.length > 0 && !q.error && !q.isPaused && !held
  return fine ? null : statusText(q, rateLimited)
}
