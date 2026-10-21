import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient, type Query } from '@tanstack/react-query'
import {
  removeOldestQuery,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client'
import { keptFor, QUERIES } from '../features/anime/queries.ts'
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
      // Must be at least as long as a list is kept (a day, see keptFor), or TanStack drops a list
      // no component is using before then, and the next save leaves it out of the copy.
      gcTime: DAY,
      retry: shouldRetry,
    },
  },
})

// A title is kept up to 30 days (a finished one, see keptFor), so TanStack keeps it for as long as
// the tab stays open, restored from a copy or asked for. Not 30 days: setTimeout waits at most
// about 24.8 days, and given longer waits no time at all, so the title would go at once.
queryClient.setQueryDefaults(['anilist', QUERIES.title], { gcTime: Infinity })

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

// What a saved copy brings back: each answer only while it is kept (see keptFor), however lately the
// copy was saved, since a copy is saved again whenever anything in it changes, and only answers to
// a query the app still asks with. Each answer is saved under its query's exact text, so an edit to
// a query leaves the answers under the old text where nothing looks them up again. A copy that
// isn't one TanStack saved is left for TanStack to throw away.
const restored = (saved: string): PersistedClient => {
  const copy = JSON.parse(saved)
  const queries: PersistedClient['clientState']['queries'] | undefined = copy?.clientState?.queries
  if (!Array.isArray(queries)) return copy
  const asked: unknown[] = Object.values(QUERIES)
  copy.clientState.queries = queries.filter(
    ({ queryKey, state }) =>
      asked.includes(queryKey[1]) &&
      Date.now() - state.dataUpdatedAt < keptFor(queryKey, state.data),
  )
  return copy
}

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
// A skipped save leaves the copy's timestamp as it was, so after the page's first save, the copy's
// 30 days (maxAge) count from the last change to what is saved, not from the visitor's last
// activity, such as searches that fail while AniList is down. Each answer in it comes back only
// while it is kept anyway (see restored), however lately the copy was saved.
export const cachePersister = (
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): Persister => {
  const persister = createAsyncStoragePersister({
    storage,
    key: 'anibeam:cache',
    retry: removeOldestQuery,
    deserialize: restored,
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
  // As long as anything is kept: a finished title, 30 days (see keptFor).
  maxAge: 30 * DAY,
  dehydrateOptions: {
    // By default TanStack saves only queries whose last fetch succeeded, so a failed
    // refresh would erase the saved list. Save every result we still have while it is kept
    // (see keptFor): maxAge only checks when the whole copy was last saved.
    shouldDehydrateQuery: (query: Query) =>
      query.state.data !== undefined &&
      Date.now() - query.state.dataUpdatedAt < keptFor(query.queryKey, query.state.data),
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
