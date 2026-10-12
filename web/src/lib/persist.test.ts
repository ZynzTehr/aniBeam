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
 * The trending list holding `titles` from `answeredAt` (by default, `savedAt`), written out as
 * today's app saves it at `savedAt`: the JSON it stores under anibeam:cache, with buster v2 and
 * each list as TanStack dehydrates it.
 */
function savedCopy(savedAt: number, titles: Media[], answeredAt = savedAt) {
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
            dataUpdatedAt: answeredAt,
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

test('asking for a search writes nothing until its answer comes', async (t) => {
  // A list is saved only once it has titles, so a save as a search is asked for would write the
  // whole copy, which can be megabytes, with nothing new in it, while the page draws the search.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  ask(client, 'frieren')(SAMPLES.slice(0, 2))
  await wait(t, 2000) // frieren is saved, then a second goes by with nothing new to save
  const writes = t.mock.method(storage, 'setItem')
  ask(client, 'mushishi') // its answer never comes
  await wait(t) // no time passes
  assert.equal(
    writes.mock.callCount(),
    0,
    'asking for a search wrote the whole copy again, with nothing new in it',
  )
})

test('a search answered 1.5 seconds after it was asked is saved at once', async (t) => {
  // Neither asking nor the fetch starting saves anything (see the test above), so neither starts a
  // second that the answer must then wait out: it is saved as it arrives, since nothing was saved
  // in the second before.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  ask(client, 'frieren')(SAMPLES.slice(0, 2))
  await wait(t, 2000) // frieren is saved, then a second goes by with nothing new to save
  const answer = ask(client, 'mushishi')
  await wait(t, 1500)
  const titles = SAMPLES.slice(2, 4)
  answer(titles)
  await wait(t) // no time passes
  assert.deepEqual(
    savedSearches(storage).mushishi,
    titles,
    'the answer, 1.5 s after its search, was not saved as it arrived: a tab closed now would lose it',
  )
})

test('each change to a saved list is saved at once: new titles, being marked out of date, a failed refresh, removal', async (t) => {
  // A save goes on only when the lists it would save have changed (see queryClient.ts). Each of
  // these changes what a visitor gets back on their next visit, so none may pass for no change.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  ask(client, 'frieren')(SAMPLES.slice(0, 2))
  await wait(t, 2000) // frieren is saved, then a second goes by with nothing new to save
  const { queryKey } = searchQuery('frieren')
  const titles = SAMPLES.slice(2, 4)
  const offline = () => Promise.reject(new TypeError('Failed to fetch'))
  // What the saved copy holds of the search, the only list in it.
  const saved = () => {
    const state = JSON.parse(storage.items.get('anibeam:cache')!).clientState.queries[0]?.state
    return state && { titles: state.data, status: state.status, outOfDate: state.isInvalidated }
  }
  const changes = [
    {
      change: 'new titles from a refresh',
      make: () => client.fetchQuery({ queryKey, queryFn: async () => titles }),
      holds: { titles, status: 'success', outOfDate: false },
    },
    {
      change: 'marking the list out of date',
      make: () => client.invalidateQueries({ queryKey }),
      holds: { titles, status: 'success', outOfDate: true },
    },
    {
      change: 'a failed refresh',
      make: () => client.fetchQuery({ queryKey, queryFn: offline, retry: false }).catch(() => {}),
      holds: { titles, status: 'error', outOfDate: true },
    },
    {
      change: 'removing the list',
      make: () => client.removeQueries({ queryKey }),
      holds: undefined,
    },
  ]
  for (const { change, make, holds } of changes) {
    void make()
    await wait(t) // no time passes
    assert.deepEqual(saved(), holds, `${change} did not reach the saved copy at once`)
    await wait(t, 1000) // a quiet second, so the next change is saved at once too
  }
})

test('the saved copy expires a day after its last change, not a day after the visitor’s last search', async (t) => {
  // A save that would change nothing is skipped (see queryClient.ts), so it leaves the copy's
  // timestamp, which maxAge counts from, as it was. While AniList is down, every search the visitor
  // makes fails and changes nothing that is saved: after 23 hours of them, the copy still expires a
  // day after the last answer. That is on purpose: by then the answer is over a day old, and lists
  // that old are not saved again either. Were such saves let through to stamp the copy anew, even
  // hours apart, the answer would come back 24.5 hours after it arrived.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const answeredAt = Date.now()
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  const titles = SAMPLES.slice(0, 2)
  ask(client, 'frieren')(titles)
  await wait(t, 1000) // the copy is saved at most once a second, so the answer is saved by now
  // AniList goes down. For 23 hours, the visitor searches every hour, and each search fails.
  const offline = () => Promise.reject(new TypeError('Failed to fetch'))
  for (let hour = 1; hour <= 23; hour++) {
    t.mock.timers.tick(HOUR)
    void client.prefetchQuery({ ...searchQuery(`search ${hour}`), queryFn: offline, retry: false })
    await wait(t) // no time passes
  }
  await wait(t, 1000) // any save is made by now
  assert.deepEqual(
    savedSearches(storage),
    { frieren: titles },
    'after 23 hours of searches that failed, the saved copy did not hold the answer',
  )
  // The next visit, 24.5 hours after the answer and an hour and a half after the last search.
  t.mock.timers.setTime(answeredAt + 24 * HOUR + 30 * MINUTE)
  const next = new QueryClient()
  await persistQueryClientRestore({
    ...persistOptions,
    queryClient: next,
    persister: cachePersister(storage),
  })
  assert.equal(
    next.getQueryData(searchQuery('frieren').queryKey),
    undefined,
    'the answer came back 24.5 hours after it arrived: searches that saved nothing new stamped the copy anew, so its day ran from a later search, not from its last change',
  )
})

// The persister the page itself uses. Every test above hands persistOptions a persister of its own,
// cachePersister(storage), so none of them sees the one persistOptions builds for the page from
// browserStorage(): built without the retry, or without the skip, it would pass them all. The
// first two run the full-storage and asking tests above through persistOptions as the page has it;
// the last reloads the page.

/**
 * persistOptions as the page has it, persister and all, from a fresh copy of queryClient.ts
 * loaded in a window whose localStorage is `storage`. As in storage.test.ts, the query string makes
 * the copy a module of its own, so Node runs it again, in that window. Each test needs a `tag` of
 * its own: with another test's, it would get that test's copy, whose persister writes to that
 * test's storage. The window stays until the test ends, as it would on the page; then window and
 * localStorage go back as they were.
 */
async function pageOptions(t: TestContext, tag: string, storage: ReturnType<typeof fakeStorage>) {
  const before = ['window', 'localStorage'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  t.after(() => {
    for (const [name, descriptor] of before)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  // In a browser, window is globalThis, so localStorage is the same however it is read.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  const page = (await import(
    new URL(`./queryClient.ts?${tag}`, import.meta.url).href
  )) as typeof import('./queryClient.ts')
  return page.persistOptions
}

test('with storage full, the page’s own persister still saves the newest lists', async (t) => {
  // The full-storage test above, through the page's persister: without its retry, once a visitor's
  // storage is full every save would fail, rather than the oldest lists making way.
  const storage = fakeStorage(25_000) // room for two of these lists, not three
  const options = await pageOptions(t, 'page-full-storage', storage)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const client = new QueryClient()
  const list = ['x'.repeat(10_000)]
  // The full-storage test's six lists, so four must go.
  client.setQueryData(['trending'], list, { updatedAt: now - MINUTE })
  client.setQueryData(['1980s'], list, { updatedAt: now - 6 * MINUTE })
  client.setQueryData(['mushishi'], list, { updatedAt: now - 5 * MINUTE })
  client.setQueryData(['1990s'], list, { updatedAt: now - 4 * MINUTE })
  client.setQueryData(['naruto'], list, { updatedAt: now - 3 * MINUTE })
  client.setQueryData(['frieren'], list, { updatedAt: now - 2 * MINUTE })

  const saving = persistQueryClientSave({ ...options, queryClient: client })
  t.mock.timers.tick(1000) // the copy is saved at most once a second
  await saving
  const saved = storage.items.get('anibeam:cache')
  assert.ok(saved, 'with storage full, the page’s own persister saved nothing under anibeam:cache')
  assert.deepEqual(
    JSON.parse(saved).clientState.queries.map((query: { queryKey: string[] }) => query.queryKey),
    [['trending'], ['frieren']],
    'with storage full, the page’s own persister did not save the newest lists that fit',
  )
})

test('with the page’s own persister, asking for a search writes nothing', async (t) => {
  // The asking test above, through the page's persister: without its skip, each search the visitor
  // asks for writes the whole copy, which can be megabytes, while the page draws the search.
  const storage = fakeStorage()
  const options = await pageOptions(t, 'page-asking', storage)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const client = new QueryClient()
  t.after(persistQueryClientSubscribe({ ...options, queryClient: client }))
  const titles = SAMPLES.slice(0, 2)
  ask(client, 'frieren')(titles)
  await wait(t, 2000) // frieren is saved, then a second goes by with nothing new to save
  // The page's persister saves to this storage, so no write below means it skipped the save.
  assert.deepEqual(
    savedSearches(storage),
    { frieren: titles },
    'the page’s own persister did not save the answer under anibeam:cache',
  )
  const writes = t.mock.method(storage, 'setItem')
  ask(client, 'mushishi') // its answer never comes
  await wait(t) // no time passes
  assert.equal(
    writes.mock.callCount(),
    0,
    'with the page’s own persister, asking for a search wrote the whole copy again, with nothing new in it',
  )
})

test('the first save after the page loads always goes on, so titles over a day old do not come back on the next reload', async (t) => {
  // Restoring checks only when the copy was saved, not how old its lists are, so a copy saved two
  // hours ago brings back trending's titles from 25 hours ago. The first save after the page loads
  // must still go on, though all it writes is a copy with no lists (results over a day old are not
  // saved again): were it skipped as changing nothing, the old copy would stay, and with AniList
  // down those titles would come back on every reload until it expires, 22 hours on. Each load of
  // the page builds its persister anew, and that one persister restores the copy and then saves
  // each change; so does this test, with persistOptions from a fresh copy of queryClient.ts.
  const storage = fakeStorage()
  const options = await pageOptions(t, 'page-reload', storage)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const { queryKey } = trendingQuery()
  const titles = SAMPLES.slice(0, 2)
  storage.items.set('anibeam:cache', savedCopy(now - 2 * HOUR, titles, now - 25 * HOUR))
  const client = new QueryClient()
  await persistQueryClientRestore({ ...options, queryClient: client })
  assert.deepEqual(
    client.getQueryData(queryKey),
    titles,
    'the titles in a copy saved 2 hours ago did not come back',
  )
  t.after(persistQueryClientSubscribe({ ...options, queryClient: client }))
  // AniList is down: the refresh of those titles fails.
  const offline = () => Promise.reject(new TypeError('Failed to fetch'))
  void client.fetchQuery({ queryKey, queryFn: offline, retry: false }).catch(() => {})
  await wait(t, 1000) // the copy is saved at most once a second, so any save is made by now
  const next = new QueryClient() // the next reload
  await persistQueryClientRestore({
    ...persistOptions,
    queryClient: next,
    persister: cachePersister(storage),
  })
  assert.equal(
    next.getQueryData(queryKey),
    undefined,
    'titles over a day old came back on the next reload: the first save after the page loaded left them in the copy',
  )
})
