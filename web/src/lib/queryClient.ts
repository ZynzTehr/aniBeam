import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClient, type Query } from '@tanstack/react-query'
import { removeOldestQuery } from '@tanstack/react-query-persist-client'
import { AniListError } from './anilist.ts'

const DAY = 24 * 60 * 60 * 1000

// Every retry of a rate limit or a failed connection first waits out anilist()'s
// one-minute pause, so a failed connection is retried once and AniList errors up
// to 3 times. Retrying a bad request (4xx other than 429) only burns the budget.
export const shouldRetry = (failures: number, error: Error) =>
  failures < (error instanceof AniListError ? 3 : 1) &&
  !(
    error instanceof AniListError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  )

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Must be at least the persisted maxAge, or saved results are dropped early.
      gcTime: DAY,
      retry: shouldRetry,
    },
  },
})

// Browsers can block storage entirely (e.g. "block all site data"); the app then
// still works, just without a saved cache.
function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

// localStorage holds about 5 MB per site; removeOldestQuery drops the oldest
// result when it is full. Upgrade path if that ever limits us: an IndexedDB persister.
export const persistOptions = {
  persister: createSyncStoragePersister({
    storage: browserStorage(),
    key: 'anibeam:cache',
    retry: removeOldestQuery,
  }),
  maxAge: DAY,
  dehydrateOptions: {
    // By default TanStack saves only queries whose last fetch succeeded, so a failed
    // refresh would erase the saved list. Save every result we still have unless it is
    // over a day old (maxAge only checks when the whole cache was last saved).
    shouldDehydrateQuery: (query: Query) =>
      query.state.data !== undefined && Date.now() - query.state.dataUpdatedAt < DAY,
  },
  // Cache keys include each query's text and variables (see queries.ts), so editing a
  // query never reuses old saved results. Change this only if the code that reshapes
  // results changes. (v2: keys switched to that format.)
  buster: 'v2',
}
