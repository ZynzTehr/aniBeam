// The saved cache (see queryClient.ts) as returning visitors have it. Their browsers hold the copy
// an earlier version of the app saved, so it must still come back after the code that saves it
// changes, and a full storage must not stop the saving.
import { hashKey, QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  ERAS,
  poolQuery,
  QUERIES,
  searchQuery,
  titleQuery,
  trendingQuery,
  type Media,
  type Title,
} from '../features/anime/queries.ts'
import { SAMPLES } from '../features/anime/samples.ts'
import { cachePersister, persistOptions, POOLS_SAVED } from './queryClient.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

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

/** One saved answer: its query's key, what came back, and when it came. */
type Saved = [queryKey: QueryKey, data: unknown, answeredAt: number]

/**
 * `answers`, written out as today's app saves them at `savedAt`: the JSON it stores under
 * anibeam:cache, with buster v2 and each answer as TanStack dehydrates it, under the hash TanStack
 * looks it up by.
 */
function copyOf(savedAt: number, answers: Saved[]) {
  return JSON.stringify({
    buster: 'v2',
    timestamp: savedAt,
    clientState: {
      mutations: [],
      queries: answers.map(([queryKey, data, answeredAt]) => ({
        dehydratedAt: savedAt,
        state: {
          data,
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
        queryHash: hashKey(queryKey),
      })),
    },
  })
}

/**
 * The trending list holding `titles` from `answeredAt` (by default, `savedAt`), saved at
 * `savedAt` (see copyOf).
 */
const savedCopy = (savedAt: number, titles: Media[], answeredAt = savedAt) =>
  copyOf(savedAt, [[trendingQuery().queryKey, titles, answeredAt]])

/** A client holding what the page gets back from `storage`'s copy as it restores it. */
async function restore(storage: ReturnType<typeof fakeStorage>) {
  const client = new QueryClient()
  await persistQueryClientRestore({
    ...persistOptions,
    queryClient: client,
    persister: cachePersister(storage),
  })
  return client
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

test('a list comes back 23 hours after it came, and not 25', async (t) => {
  // A list is kept a day, so a visitor back the next evening still has last night's titles, and one
  // back after a week never sees that week's. The copy itself lasts 30 days (maxAge), for finished
  // titles (see the tests below), so each list goes by its own age. The test above sees only a keep
  // of over an hour, and every browser check reads a copy saved seconds before.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2030, 0, 1) })
  const { queryKey } = trendingQuery()
  const titles = SAMPLES.slice(0, 2)
  // The trending titles the page has once it has restored a copy saved `hours` ago.
  const restored = async (hours: number) => {
    const storage = fakeStorage()
    storage.items.set('anibeam:cache', savedCopy(Date.now() - hours * HOUR, titles))
    return (await restore(storage)).getQueryData(queryKey)
  }
  assert.deepEqual(
    await restored(23),
    titles,
    'a list saved 23 hours ago did not come back: lists are kept less than a day',
  )
  assert.equal(
    await restored(25),
    undefined,
    'a list saved 25 hours ago came back: lists are kept more than a day',
  )
})

// What a copy brings back. A copy is saved again whenever what it holds changes, so a copy saved an
// hour ago can hold answers from the day before; each must come back only while it is kept.

/** A title AniList says is finished, and one still airing. */
const finished: Title = { ...SAMPLES[0], status: 'FINISHED' }
const airing: Title = { ...SAMPLES[1], status: 'RELEASING' }

test('each saved answer comes back only while its kind is kept, however lately the copy was saved', async (t) => {
  // A list is kept a day, so a visitor back after a week never sees that week's lists. A title
  // AniList says is finished is kept 30 days, as its details won't change; one still airing, a
  // day, as its next episode does. Each goes by the time it has been kept, not by how long it stays
  // fresh (staleTime): a trending list goes out of date after 30 minutes, and must still come back
  // then, to show while the page asks for a newer one (see refresh.e2e.ts).
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const titles = SAMPLES.slice(2, 4)
  const lateAiring: Title = { ...SAMPLES[4], status: 'RELEASING' }
  const storage = fakeStorage()
  storage.items.set(
    'anibeam:cache',
    copyOf(now - HOUR, [
      [trendingQuery().queryKey, titles, now - 23 * HOUR],
      [searchQuery('frieren').queryKey, titles, now - 25 * HOUR],
      [titleQuery(finished.id).queryKey, finished, now - 25 * HOUR],
      [titleQuery(airing.id).queryKey, airing, now - 25 * HOUR],
      [titleQuery(lateAiring.id).queryKey, lateAiring, now - 23 * HOUR],
    ]),
  )
  const client = await restore(storage)
  const back = (queryKey: QueryKey) => client.getQueryData(queryKey) !== undefined
  assert.deepEqual(
    {
      'trending, 23 hours old': back(trendingQuery().queryKey),
      'a search, 25 hours old': back(searchQuery('frieren').queryKey),
      'a finished title, 25 hours old': back(titleQuery(finished.id).queryKey),
      'an airing title, 25 hours old': back(titleQuery(airing.id).queryKey),
      'an airing title, 23 hours old': back(titleQuery(lateAiring.id).queryKey),
    },
    {
      'trending, 23 hours old': true,
      'a search, 25 hours old': false,
      'a finished title, 25 hours old': true,
      'an airing title, 25 hours old': false,
      'an airing title, 23 hours old': true,
    },
    'from a copy saved an hour ago, these did (true) or did not (false) come back',
  )
})

test('an answer saved under a query’s old text does not come back', async () => {
  // Each answer is saved under its query's exact text (see queries.ts), so an edit to a query, as a
  // new field, leaves the answers saved under the old text where nothing asks for them again. A
  // finished title's would still take room in storage for 30 days, crowding out the lists. Here,
  // trending as the last release asked for it, before the lists carried where a trailer is.
  const lastRelease = QUERIES.trending.replace(' trailer { id site }', '')
  assert.notEqual(lastRelease, QUERIES.trending, 'trending’s text no longer asks for trailers')
  const storage = fakeStorage()
  storage.items.set(
    'anibeam:cache',
    copyOf(Date.now() - HOUR, [
      [trendingQuery().queryKey, SAMPLES.slice(0, 2), Date.now() - HOUR],
      [['anilist', lastRelease, {}], SAMPLES.slice(2, 4), Date.now() - HOUR],
    ]),
  )
  const client = await restore(storage)
  assert.deepEqual(
    client
      .getQueryCache()
      .getAll()
      .map(({ queryKey }) => (queryKey[1] === QUERIES.trending ? 'today’s' : 'the old text’s')),
    ['today’s'],
    'trending came back under the old text as well as today’s',
  )
})

test('a finished title comes back 29 days after it came, and not 31', async (t) => {
  // AniList's answer for a finished title is kept 30 days (spec §3H), as its details won't change,
  // so a visitor back to its address within the month opens it with no request. The copy holding it
  // was last saved as it came: nothing else changed since.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2030, 0, 1) })
  const { queryKey } = titleQuery(finished.id)
  // The title the page has once it has restored a copy saved `days` ago, as the title came.
  const restored = async (days: number) => {
    const storage = fakeStorage()
    const savedAt = Date.now() - days * DAY
    storage.items.set('anibeam:cache', copyOf(savedAt, [[queryKey, finished, savedAt]]))
    return (await restore(storage)).getQueryData(queryKey)
  }
  assert.deepEqual(
    await restored(29),
    finished,
    'a finished title saved 29 days ago did not come back: finished titles are kept less than 30 days',
  )
  assert.equal(
    await restored(31),
    undefined,
    'a finished title saved 31 days ago came back: finished titles are kept more than 30 days',
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

// A decade's mood pool is about 100 whole titles, up to about 250 KB once cut (see poolOf), so the
// saved copy keeps only the newest POOLS_SAVED (the plan's B1). Five decades opened with a slider
// set, so two must go, and the newest is not the last asked for, so the cache's order isn't theirs.
test('of five decades’ mood pools, only the newest three are saved, with every list', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const storage = fakeStorage()
  const client = new QueryClient()
  const pool = (count: number) => ({ titles: [], count, hasNextPage: true })
  const minutesAgo = { '1980s': 6, '1990s': 1, '2000s': 5, '2010s': 3, '2020s': 2 }
  for (const [id, minutes] of Object.entries(minutesAgo))
    client.setQueryData(poolQuery(ERAS.find((era) => era.id === id)!).queryKey, pool(minutes), {
      updatedAt: now - minutes * MINUTE,
    })
  client.setQueryData(trendingQuery().queryKey, SAMPLES.slice(0, 2), { updatedAt: now - HOUR })

  const saving = persistQueryClientSave({
    ...persistOptions,
    queryClient: client,
    persister: cachePersister(storage),
  })
  t.mock.timers.tick(1000) // the copy is saved at most once a second
  await saving
  const saved: { queryKey: unknown[]; state: { data: { count?: number } } }[] = JSON.parse(
    storage.items.get('anibeam:cache') ?? '{"clientState":{"queries":[]}}',
  ).clientState.queries
  assert.equal(POOLS_SAVED, 3)
  assert.deepEqual(
    saved
      .filter(({ queryKey }) => queryKey[1] === QUERIES.pool)
      .map(({ state }) => state.data.count),
    [1, 3, 2],
    'not the 1990s, 2010s and 2020s, the three pools that came last, in the cache’s order',
  )
  assert.ok(
    saved.some(({ queryKey }) => queryKey[1] === QUERIES.trending),
    'a list went with the pools',
  )
  // The page keeps all five for the visit: only the copy goes without the oldest.
  assert.equal(client.getQueryCache().findAll({ queryKey: ['anilist', QUERIES.pool] }).length, 5)
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

/**
 * A page's frames and whether its tab shows, run by the test: `draw()` runs the frames asked for,
 * and `hide()` hides the tab, as a visitor switching tabs or closing this one does. Until the test
 * ends, the page's requestAnimationFrame and document are these.
 */
function fakePage(t: TestContext) {
  const frames: (() => void)[] = []
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const before = ['requestAnimationFrame', 'document'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  t.after(() => {
    for (const [name, descriptor] of before)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (frame: () => void) => frames.push(frame),
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  return {
    draw: () => frames.splice(0).forEach((frame) => frame()),
    hide: () => {
      document.visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    show: () => {
      document.visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

test('in a browser, an answer is saved once the page has drawn it, and at once in a hidden tab', async (t) => {
  // Each save writes out the whole copy: about 100 ms once it has grown to 4.3 MB, as a day of
  // searches can make it. TanStack asks for the save as an answer arrives, before the page draws it,
  // so the visitor would wait that long for their titles. The save waits for the page's next frame
  // and goes on just after it is drawn. A hidden tab draws no frames, so there an answer is saved at
  // once, and one still waiting is saved as the tab is hidden, as closing it does first: a tab
  // closed then must still have it next time.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const page = fakePage(t)
  const storage = fakeStorage()
  const client = new QueryClient()
  t.after(saveChanges(client, storage))
  const titles = SAMPLES.slice(0, 2)
  const answer = ask(client, 'frieren')
  await wait(t) // no time passes
  page.draw()
  await wait(t, 2000) // asking is saved, then a second goes by with nothing new to save
  answer(titles)
  // A moment passes and no frame is drawn: a save that waited for the next task alone, not the
  // next frame, would go on now.
  await wait(t, 1)
  assert.deepEqual(savedSearches(storage), {}, 'the answer was saved before the page drew it')
  page.draw()
  await wait(t) // no time passes
  assert.deepEqual(
    savedSearches(storage),
    {},
    'the answer was saved as the page drew its frame, holding the frame up',
  )
  await wait(t, 1)
  assert.deepEqual(
    savedSearches(storage),
    { frieren: titles },
    'the answer was not saved once the page had drawn it',
  )

  await wait(t, 1000) // a quiet second, so the next answer is saved as it can be
  page.hide()
  const hidden = SAMPLES.slice(2, 4)
  ask(client, 'mushishi')(hidden)
  await wait(t) // no time passes
  assert.deepEqual(
    savedSearches(storage).mushishi,
    hidden,
    'in a hidden tab, which draws no frames, the answer was not saved at once',
  )

  await wait(t, 1000)
  page.show()
  const closing = SAMPLES.slice(4, 6)
  ask(client, 'naruto')(closing)
  await wait(t) // no time passes
  page.hide() // before the next frame
  await wait(t) // no time passes
  assert.deepEqual(
    savedSearches(storage).naruto,
    closing,
    'an answer waiting for the next frame was not saved as the tab was hidden: a tab closed now would lose it',
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

test('an answer leaves the saved copy a day after it came, however long the visitor goes on searching', async (t) => {
  // A save that would change nothing is skipped (see queryClient.ts), so it leaves the copy's
  // timestamp as it was. While AniList is down, every search the visitor makes fails and changes
  // nothing that is saved. Either way the answer comes back no later than a day after it came:
  // restoring goes by each answer's own age (see keptFor), not by when the copy was last saved,
  // which with the copy lasting 30 days (maxAge, for finished titles) would let it back for a month.
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
    'the answer came back 24.5 hours after it arrived: restoring went by when the copy was saved, not by how old the answer was',
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

test('the first save after the page loads always goes on, so titles over a day old leave the stored copy', async (t) => {
  // A copy saved two hours ago can hold trending's titles from 25 hours ago. They no longer come
  // back (see the tests above), but they stay in storage until a save writes the copy anew. The
  // first save after the page loads must go on, though all it writes is a copy with no lists: were
  // it skipped as changing nothing, as nothing came back and nothing new has come, those titles
  // would go on taking room in storage, with AniList down, until something else is saved. Each
  // load of the page builds its persister anew, and that one persister restores the copy and then
  // saves each change; so does this test, with persistOptions from a fresh copy of queryClient.ts.
  const storage = fakeStorage()
  const options = await pageOptions(t, 'page-reload', storage)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const { queryKey } = trendingQuery()
  const titles = SAMPLES.slice(0, 2)
  storage.items.set('anibeam:cache', savedCopy(now - 2 * HOUR, titles, now - 25 * HOUR))
  const client = new QueryClient()
  await persistQueryClientRestore({ ...options, queryClient: client })
  assert.equal(
    client.getQueryData(queryKey),
    undefined,
    'trending’s titles from 25 hours ago came back from a copy saved 2 hours ago',
  )
  t.after(persistQueryClientSubscribe({ ...options, queryClient: client }))
  // AniList is down: the page's request for trending fails.
  const offline = () => Promise.reject(new TypeError('Failed to fetch'))
  void client.fetchQuery({ queryKey, queryFn: offline, retry: false }).catch(() => {})
  await wait(t, 1000) // the copy is saved at most once a second, so any save is made by now
  assert.deepEqual(
    JSON.parse(storage.items.get('anibeam:cache')!).clientState.queries,
    [],
    'titles over a day old stayed in the stored copy: the first save after the page loaded was skipped',
  )
})
