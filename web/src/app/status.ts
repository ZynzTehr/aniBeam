import { AniListError } from '../lib/anilist.ts'

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
      return 'AniList rate limit reached; retrying automatically when it resets.'
    if (q.failureReason instanceof TypeError)
      return "Can't reach AniList right now; retrying automatically in a minute."
    if (rateLimited) return 'Waiting a minute before contacting AniList again.'
  }
  if (!q.data) return q.error ? `Error: ${q.error.message}` : 'Loading…'
  if (q.error && !q.isFetching) return `Error: ${q.error.message} (showing earlier results)`
  if (q.data.length === 0) return 'No titles found.'
  const fetchedAt = new Date(q.dataUpdatedAt).toLocaleTimeString()
  return `${q.data.length} titles, fetched at ${fetchedAt}${q.isFetching ? ' (refreshing…)' : ''}`
}
