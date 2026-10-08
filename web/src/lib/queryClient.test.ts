import { dehydrate, QueryClient } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from './anilist.ts'
import { trendingQuery } from '../features/anime/queries.ts'
import { persistOptions, queryClient, shouldRetry } from './queryClient.ts'

const DAY = 24 * 60 * 60 * 1000

test('retries rate limits and server errors up to 3 times, network failures once', () => {
  // Every retry of a rate limit or a network failure first waits out a one-minute pause.
  assert.equal(shouldRetry(2, new AniListError('Too Many Requests.', 429)), true)
  assert.equal(shouldRetry(3, new AniListError('Too Many Requests.', 429)), false)
  assert.equal(shouldRetry(0, new AniListError('Internal Server Error', 500)), true)
  assert.equal(shouldRetry(0, new AniListError('AniList request failed (HTTP 502)', 502)), true)
  assert.equal(shouldRetry(0, new TypeError('Failed to fetch')), true)
  assert.equal(shouldRetry(1, new TypeError('Failed to fetch')), false)
})

test('never retries a bad request, which would only spend the rate limit', () => {
  assert.equal(shouldRetry(0, new AniListError('Validation error', 400)), false)
  assert.equal(shouldRetry(0, new AniListError('Not Found.', 404)), false)
})

test('a query that hits the rate limit recovers on its own once the limit resets', async (t) => {
  // The real app client and query; only AniList (fetch) and the clock are fake.
  const start = Date.UTC(2030, 0, 1)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start })
  t.after(() => queryClient.clear())
  const sentAt: number[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sentAt.push(Date.now())
    return sentAt.length === 1
      ? new Response(
          JSON.stringify({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }),
          { status: 429 },
        )
      : new Response(JSON.stringify({ data: { Page: { media: [] } } }))
  })

  const result = queryClient.query(trendingQuery())
  for (let second = 0; second < 60; second++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(1000)
  }
  assert.deepEqual(await result, [])
  assert.deepEqual(sentAt, [start, start + 60_000])
})

// What the persister would write to localStorage: [queryKey, data] for each saved query.
const saved = (client: QueryClient) =>
  dehydrate(client, persistOptions.dehydrateOptions).queries.map((q) => [q.queryKey, q.state.data])

test('a failed refresh keeps the last good list in the saved cache', async () => {
  const client = new QueryClient()
  client.setQueryData(['trending'], [{ id: 1 }])
  const offline = () => Promise.reject(new TypeError('Failed to fetch'))
  await client.query({ queryKey: ['trending'], queryFn: offline, retry: false }).catch(() => {})

  assert.equal(client.getQueryState(['trending'])?.status, 'error')
  assert.deepEqual(saved(client), [[['trending'], [{ id: 1 }]]])
})

test('results older than a day are not saved again', () => {
  const client = new QueryClient()
  client.setQueryData(['fresh'], [{ id: 1 }])
  client.setQueryData(['old'], [{ id: 2 }], { updatedAt: Date.now() - DAY - 1 })
  assert.deepEqual(saved(client), [[['fresh'], [{ id: 1 }]]])
})
