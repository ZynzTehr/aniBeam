import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { removeOldestQuery } from '@tanstack/react-query-persist-client'
import { AniListError } from './anilist.ts'

const DAY = 24 * 60 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Must be at least the persisted maxAge, or saved results are dropped early.
      gcTime: DAY,
      // Retrying a bad request (4xx) only burns the 30/minute budget. A 429 is
      // worth retrying: anilist() waits for the rate limit to reset first.
      retry: (failures, error) =>
        failures < 3 &&
        !(
          error instanceof AniListError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 429
        ),
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
  // Change this when a query's fields change, so old saved results are discarded.
  buster: 'v1',
}
