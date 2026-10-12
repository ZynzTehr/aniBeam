// The saved cache (see queryClient.ts) as returning visitors have it. Their browsers hold the copy
// an earlier version of the app saved, so it must still come back after the code that saves it
// changes, and a full storage must not stop the saving.
import { QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trendingQuery } from '../features/anime/queries.ts'
import { SAMPLES } from '../features/anime/samples.ts'
import { cachePersister, persistOptions } from './queryClient.ts'

const MINUTE = 60_000

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

test('a copy today’s app saved comes back an hour later, titles and all', async () => {
  // Written out as today's app stores it: JSON under anibeam:cache, with buster v2 and each list as
  // TanStack dehydrates it. Every returning visitor's titles are saved this way, so a change to the
  // key, the buster or how the copy is read would throw them all away.
  const storage = fakeStorage()
  const savedAt = Date.now() - 60 * MINUTE
  const { queryKey } = trendingQuery()
  const titles = SAMPLES.slice(0, 2)
  storage.items.set(
    'anibeam:cache',
    JSON.stringify({
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
    }),
  )

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

test('when storage is full, the oldest results make way and the rest are still saved', async (t) => {
  // localStorage holds about 5 MB per site. A visitor who has searched a lot can fill it; then the
  // oldest results go, as many as it takes, rather than the whole copy failing to save.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2030, 0, 1) })
  const now = Date.now()
  const storage = fakeStorage(25_000) // room for two of these lists, not three
  const client = new QueryClient()
  const list = ['x'.repeat(10_000)]
  // Trending was asked for first but refreshed last, so the cache's order isn't the lists' age.
  client.setQueryData(['trending'], list, { updatedAt: now - MINUTE })
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
