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
      // no component is using before then, and the next save leaves it out of the copy. Titles
      // and My List, kept longer, have their own below.
      gcTime: DAY,
      retry: shouldRetry,
    },
  },
})

// A title is kept up to 30 days (a finished one, see keptFor), so TanStack keeps it for as long as
// the tab stays open, restored from a copy or asked for. Not 30 days: setTimeout waits at most
// about 24.8 days, and given longer waits no time at all, so the title would go at once.
queryClient.setQueryDefaults(['anilist', QUERIES.title], { gcTime: Infinity })
// My List's titles too, kept 30 days so the list shows offline: with a day's gcTime, a tab left
// open a day away from My List would drop them, and the next save would leave them out.
queryClient.setQueryDefaults(['anilist', QUERIES.list], { gcTime: Infinity })

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

// Each save writes out the whole copy, about 100 ms once it has grown to 4.3 MB. A day of searches
// can make it about that big (150 make 3.7 million characters), while a finished title kept 30
// days adds about 3,000, and only one opened at its address. TanStack asks for a save as an answer
// arrives, before the page draws the answer, so the visitor would wait that long for their titles:
// `save` waits for the page's next frame and goes on just after it is drawn. A hidden tab draws no
// frames, so there it goes on at once, and as soon as the tab is hidden while it waits, as closing
// the tab does first. Outside a browser, as in the unit tests, it goes on at once.
const afterDrawing = (save: () => void | PromiseLike<void>) =>
  typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden'
    ? save()
    : new Promise<void>((resolve) => {
        let started = false
        const start = () => {
          if (started) return
          started = true
          document.removeEventListener('visibilitychange', start)
          resolve(save())
        }
        requestAnimationFrame(() => setTimeout(start))
        document.addEventListener('visibilitychange', start)
      })

/**
 * How many decades' mood pools a save keeps, the newest (the plan's B1): 3, as the biggest pool
 * recorded, the 1990s' (e2e/anilist/pool-1990s.json), is 243,874 characters once cut (see poolOf),
 * well short of the 300 KB at which only 2 would be kept. Three of them are about 0.7 MB of the 5
 * MB localStorage holds, and each save writes them out with the rest (see afterDrawing). A pool's
 * page 3, asked for only once a visitor has rolled most of it, goes with it: the 1990s' is 105,152
 * characters once cut (e2e/anilist/pool-1990s-page-3.json), so three pools with theirs would be
 * about 1 MB.
 */
export const POOLS_SAVED = 3

/**
 * `saving` with only its POOLS_SAVED newest mood pools, by when each came, and the page 3 of those
 * alone (poolPage3Query), which follows its pool's titles and is nothing without them. Here, not in
 * shouldDehydrateQuery, which is asked about one query at a time and can't see the others. The
 * pools left out stay in the page's cache for the visit: only the saved copy goes without them.
 */
const newestPools = (saving: PersistedClient): PersistedClient => {
  const { queries } = saving.clientState
  const decade = ({ queryKey }: { queryKey: readonly unknown[] }) => JSON.stringify(queryKey[2])
  const pools = queries
    .filter(({ queryKey }) => queryKey[1] === QUERIES.pool)
    .toSorted((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
  const kept = new Set(pools.slice(0, POOLS_SAVED).map(decade))
  const dropped = new Set([
    ...pools.slice(POOLS_SAVED),
    ...queries.filter(
      (query) => query.queryKey[1] === QUERIES.poolPage3 && !kept.has(decade(query)),
    ),
  ])
  if (!dropped.size) return saving
  return {
    ...saving,
    clientState: { ...saving.clientState, queries: queries.filter((query) => !dropped.has(query)) },
  }
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
      const kept = newestPools(client)
      const saving = signature(kept)
      if (saving === lastSaved) return
      lastSaved = saving
      return afterDrawing(() => persister.persistClient(kept))
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
