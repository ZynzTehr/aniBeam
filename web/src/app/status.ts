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
  /** Another key's list shown while this one loads: the last decade's, or a refined search's. */
  isPlaceholderData: boolean
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
    // Any other failure, such as a server error, is retried after 1, 2 and 4 seconds.
    if (q.failureReason)
      return 'AniList had a problem. It’s not something you did. Trying again in a few seconds.'
    // Try again, or TanStack's own retry of a failed list (back on the tab, a new visit). An
    // error saved in an earlier visit comes back from storage as a plain object, not an Error.
    if (q.error) return 'Trying AniList again…'
  }
  // Errors are worded for visitors: AniList's outage is not their fault.
  // Placeholder titles belong to the previous decade or search, so this list is still loading.
  if (!q.data || q.isPlaceholderData) return q.error ? FAILED : 'Loading…'
  // With no titles on screen, a failed refresh reads like a failed first load.
  if (q.error && !q.isFetching) return q.data.length ? STALE : FAILED
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

/**
 * The status line of a section showing sample titles because it can't reach AniList (see App):
 * `what` says what the titles are, then statusText says why the section's own are held up.
 */
export function sampleNote(what: string, q: QueryStatus, rateLimited: boolean): string {
  const status = statusText(q, rateLimited)
  // The samples show only once a try has failed, so a try while they show is never a first load.
  // statusText can't tell: TanStack forgets the failure of a list with no titles as it tries again.
  return `${what} ${status === 'Loading…' ? 'Trying AniList again…' : status}`
}

/**
 * What a screen reader hears about a search, from one status line that is always on the page.
 * The term is in every message, so two searches with the same outcome still change the text
 * and each one gets announced. Offline, waiting and failure read as in the section's own line.
 */
export function searchStatus(q: QueryStatus, term: string, rateLimited: boolean): string {
  const held = q.isFetching && (rateLimited || q.failureReason !== null)
  if (q.isPaused || q.error || held) return statusText(q, rateLimited)
  if (!q.data || q.isPlaceholderData) return `Searching for “${term}”…`
  const found = q.data.length
  if (found === 0) return `No titles found for “${term}”`
  return `${found} ${found === 1 ? 'title' : 'titles'} found for “${term}”`
}
