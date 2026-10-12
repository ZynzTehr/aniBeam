// The saved cache (see queryClient.ts) as returning visitors have it. Their browsers hold the copy
// an earlier version of the app saved, so it must still come back after the code that saves it
// changes, and a full storage must not stop the saving.
import { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { searchQuery, trendingQuery, type Media } from '../features/anime/queries.ts'
import { SAMPLES } from '../features/anime/samples.ts'
import { cachePersister, persistOptions } from './queryClient.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * localStorage, as far as the saved cache uses it, holding `room` characters at most: a bigger
 * copy throws the error a browser throws when a site's storage is full.
 */
function fakeStorage(room = Infinity) {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > room)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, value)
    },
    removeItem: (key: string) => void items.delete(key),
  }
}

/**
 * The trending list holding `titles`, written out as today's app saves it at `savedAt`: the JSON it
 * stores under anibeam:cache, with buster v2 and each list as TanStack dehydrates it.
 */
function savedCopy(savedAt: number, titles: Media[]) {
  const { queryKey } = trendingQuery()
  return JSON.stringify({
    buster: 'v2',
    timestamp: savedAt,
    clientState: {
      mutations: [],
      queries: [
        {
          dehydratedAt: savedAt,
          state: {
            data: titles,
            dataUpdateCount: 1,
            dataUpdatedAt: savedAt,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: 'success',
            fetchStatus: 'idle',
          },
          queryKey,
          queryHash: JSON.stringify(queryKey),
        },
      ],
    },
  })
}

test('a copy today’s app saved comes back an hour later, titles and all', async () => {
  // Every returning visitor's titles are saved as savedCopy() writes them out, so a change to the
  // key, the buster or how the copy is read would throw them all away.
  const storage = fakeStorage()
  const { queryKey } = trendingQuery()
  const titles = SAMPLES.slice(0, 2)
  storage.items.set('anibeam:cache', savedCopy(Date.now() - HOUR, titles))

  const client = new QueryClient()
  await persistQueryClientRestore({
    ...persistOptions,
    queryClient: client,
    persister: cachePersister(storage),
  })
  assert.deepEqual(
    client.getQueryData(queryKey),
    titles,
    'the saved trending titles did not come back',
  )
})

test('a copy saved 23 hours ago comes back, and one saved 25 hours ago does not', async (t) => {
  // persistOptions keeps a copy for a day (maxAge), so a visitor back the next evening still has
  // last night's titles. The test above sees only a maxAge under an hour, and every browser check
  // reads a copy saved seconds before. PR 14 changes the day on purpose; until then, this pins it.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2030, 0, 1) })
  const { queryKey } = trendingQuery()
  const titles = SAMPLES.slice(0, 2)
  // The trending titles the page has once it has restored a copy saved `hours` ago.
  const restored = async (hours: number) => {
    const storage = fakeStorage()
    storage.items.set('anibeam:cache', savedCopy(Date.now() - hours * HOUR, titles))
    const client = new QueryClient()
    await persistQueryClientRestore({
      ...persistOptions,
      queryClient: client,
      persister: cachePersister(storage),
    })
    return client.getQueryData(queryKey)
  }
  assert.deepEqual(
    await restored(23),
    titles,
    'a copy saved 23 hours ago did not come back: the saved titles last less than a day',
  )
  assert.equal(
    await restored(25),
    undefined,
    'a copy saved 25 hours ago came back: the saved titles last more than a day',
  )
})

test('when storage is full, the oldest results make way and the rest are still saved', async (t) => {
  // localStorage holds about 5 MB per site. A visitor who has searched a lot can fill it; then the
  // oldest results go, as many as it takes, rather than the whole copy failing to save. Four of
  // these six lists must go: with only two to drop, a save that gave up after two would pass.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const storage = fakeStorage(25_000) // room for two of these lists, not three
  const client = new QueryClient()
  const list = ['x'.repeat(10_000)]
  // Trending was asked for first but refreshed last, so the cache's order isn't the lists' age.
  client.setQueryData(['trending'], list, { updatedAt: now - MINUTE })
  client.setQueryData(['1980s'], list, { updatedAt: now - 6 * MINUTE })
  client.setQueryData(['mushishi'], list, { updatedAt: now - 5 * MINUTE })
  client.setQueryData(['1990s'], list, { updatedAt: now - 4 * MINUTE })
  client.setQueryData(['naruto'], list, { updatedAt: now - 3 * MINUTE })
  client.setQueryData(['frieren'], list, { updatedAt: now - 2 * MINUTE })

  const saving = persistQueryClientSave({
    ...persistOptions,
    queryClient: client,
    persister: cachePersister(storage),
  })
  t.mock.timers.tick(1000) // the copy is saved at most once a second
  await saving
  const saved = storage.items.get('anibeam:cache')
  assert.ok(saved, 'with storage full, nothing was saved under anibeam:cache')
  assert.deepEqual(
    JSON.parse(saved).clientState.queries.map((query: { queryKey: string[] }) => query.queryKey),
    [['trending'], ['frieren']],
    'with storage full, the lists saved were not the newest that fit',
  )
})

// When the copy is saved. Each save writes the whole cache, which can grow to megabytes, so the
// page saves at most once a second. But once a list shows, the visitor may close the tab.

/** Saves the client's cache to `storage` on each change, as the page does after restoring it. */
const saveChanges = (client: QueryClient, storage: ReturnType<typeof fakeStorage>) =>
  persistQueryClientSubscribe({
    ...persistOptions,
    queryClient: client,
    persister: cachePersister(storage),
  })

/** Starts a search, as the page does, and returns the call that makes its answer arrive. */
function ask(client: QueryClient, term: string) {
  let arrive: (titles: Media[]) => void = () => {}
  void client.prefetchQuery({
    ...searchQuery(term),
    queryFn: () => new Promise<Media[]>((resolve) => (arrive = resolve)),
  })
  return (titles: Media[]) => arrive(titles)
}

/** The titles the saved copy holds for each search, by its term. */
function savedSearches(storage: ReturnType<typeof fakeStorage>) {
  const saved = storage.items.get('anibeam:cache')
  const queries: { queryKey: [string, string, { search: string }]; state: { data: Media[] } }[] =
    saved ? JSON.parse(saved).clientState.queries : []
  return Object.fromEntries(queries.map(({ queryKey, state }) => [queryKey[2].search, state.data]))
}

/**
 * Lets what is under way finish, then `ms` go by on the mocked clock a millisecond at a time. The
 * saving waits on timers, and what follows a timer runs only after tick() returns, so small steps
 * keep it at the time the timer fired, as on the real clock.
 */
async function wait(t: TestContext, ms = 0) {
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  await settle()
  for (let passed = 0; passed < ms; passed++) {
    t.mock.timers.tick(1)
    await settle()
  }
}

test('a list that arrives after a quiet second is saved at once', async (t) => {
  // An answer can come long after it was asked for: anilist() first waits out a rate limit, or the
  // connection is slow. A visitor who sees it and closes the tab must still have it next time.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  const answer = ask(client, 'frieren')
  await wait(t, 2000) // asking is saved, then a second goes by with nothing new to save
  const titles = SAMPLES.slice(0, 2)
  answer(titles)
  await wait(t) // no time passes
  assert.deepEqual(
    savedSearches(storage),
    { frieren: titles },
    'the answer was not saved as it arrived: a tab closed now would lose it',
  )
})

test('lists that arrive close together are saved at most once a second, and none waits longer', async (t) => {
  // A returning visitor's refreshes, or a few quick searches, can answer a moment apart. The next
  // list waits out the second that began as the first one arrived, and is saved as it ends.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  const first = ask(client, 'frieren')
  const next = ask(client, 'mushishi')
  await wait(t, 2000)
  first(SAMPLES.slice(0, 2))
  await wait(t, 100)
  const titles = SAMPLES.slice(2, 4)
  next(titles)
  await wait(t, 899)
  assert.equal(
    savedSearches(storage).mushishi,
    undefined,
    'the copy was saved again before a second had passed',
  )
  await wait(t, 1)
  assert.deepEqual(
    savedSearches(storage).mushishi,
    titles,
    'the next list waited more than a second to be saved',
  )
})
