import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient, type Query } from '@tanstack/react-query'
import {
  removeOldestQuery,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client'
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

// A cheap summary of what a save would write, to tell whether anything in it has changed: writing
// the copy out to compare would cost what skipping the save spares. Each list by its key, with how
// many answers and errors it has had and when the last of each came, its status and whether it was
// marked out of date; and how many mutations there are.
const signature = ({ clientState }: PersistedClient) =>
  JSON.stringify([
    clientState.mutations.length,
    clientState.queries.map(({ queryHash, state }) => [
      queryHash,
      state.dataUpdateCount,
      state.dataUpdatedAt,
      state.errorUpdateCount,
      state.errorUpdatedAt,
      state.status,
      state.isInvalidated,
    ]),
  ])

// localStorage holds about 5 MB per site; removeOldestQuery drops the oldest
// result when it is full. Upgrade path if that ever limits us: an IndexedDB persister.
// The storage is an argument so tests can hand it a stand-in (see persist.test.ts).
// TanStack asks for a save at each change to the cache, and each save writes out the whole cache,
// which can grow to megabytes. So a save goes on only if what it would save has changed since the
// last one that did (see signature). The first save after the page loads always goes on: restoring
// leaves nothing to compare it with. Asking for a list, or a fetch starting, changes nothing that
// is saved: a list is saved only once it has titles, and a fetch changes it only as it ends. The
// persister writes at most once a second (its default), and at once when it wrote nothing in the
// second before. So an answer is saved as it arrives whenever the copy was last written at least
// a second earlier, and is kept even if the tab closes as soon as it shows; otherwise it is saved
// as that second ends. The persister times its second by the wall clock, so saving pauses for as
// long as the computer's clock steps back (TanStack's own behavior, and rare enough to accept).
export const cachePersister = (
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): Persister => {
  const persister = createAsyncStoragePersister({
    storage,
    key: 'anibeam:cache',
    retry: removeOldestQuery,
  })
  let lastSaved: string | undefined
  return {
    ...persister,
    persistClient: (client) => {
      const saving = signature(client)
      if (saving === lastSaved) return
      lastSaved = saving
      return persister.persistClient(client)
    },
  }
}

export const persistOptions = {
  persister: cachePersister(browserStorage()),
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

// Try again refetches the failed lists on the page. Lists the visitor has left (other decades,
// earlier searches) are fetched again only when they're shown again: refetching them now would
// spend AniList's rate limit on answers nobody is looking at.
export const refetchFailed = (client: QueryClient) =>
  client.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' })
