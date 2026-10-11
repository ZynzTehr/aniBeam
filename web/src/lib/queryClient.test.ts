import { dehydrate, QueryClient, QueryObserver } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from './anilist.ts'
import { ERAS, eraQuery, searchQuery, trendingQuery } from '../features/anime/queries.ts'
import { persistOptions, queryClient, refetchFailed, shouldRetry } from './queryClient.ts'

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

test('Try again refetches every failed list on the page, and nothing else', async (t) => {
  // The real app client and queries; only AniList (fetch) and the clock are fake. The clock
  // starts after the pause the rate-limit test above leaves in anilist(), which lasts until
  // 2030-01-01 00:01: on the real clock, every request would wait it out.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2031, 0, 1) })
  t.after(() => queryClient.clear())
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body))
    sent.push(variables.search ?? (variables.from ? '1980s' : 'trending'))
    // The decade's request, the only one with dates, loads fine.
    if (variables.from) return new Response(JSON.stringify({ data: { Page: { media: [] } } }))
    // "API disabled": a 403 is not retried and starts no pause, so each try fails at once.
    return new Response(
      JSON.stringify({ data: null, errors: [{ message: 'API disabled', status: 403 }] }),
      { status: 403 },
    )
  })
  // Three sections, as on the page: trending, a decade, and search results that move from search
  // to search. The decade is the 1980s, not the 1990s the page opens on: the 1990s and trending
  // share one request while neither has titles (see queries.ts).
  const eighties = ERAS.find((era) => era.id === '1980s')!
  const trending = new QueryObserver(queryClient, trendingQuery())
  const decade = new QueryObserver(queryClient, eraQuery(eighties))
  const results = new QueryObserver(queryClient, searchQuery('naruto'))
  t.after(trending.subscribe(() => {}))
  t.after(decade.subscribe(() => {}))
  t.after(results.subscribe(() => {}))
  // Lets AniList's answers arrive until the decade has loaded and the other two sections show
  // their failure.
  const answered = async () => {
    while (
      !trending.getCurrentResult().isError ||
      !decade.getCurrentResult().isSuccess ||
      !results.getCurrentResult().isError
    )
      await new Promise((resolve) => setImmediate(resolve))
  }
  await answered()
  results.setOptions(searchQuery('frieren')) // the visitor searches again
  await answered()

  // One press. The 1980s loaded fine and the failed naruto search has left the page, so neither
  // is sent again.
  sent.length = 0
  await refetchFailed(queryClient)
  assert.deepEqual(sent.sort(), ['frieren', 'trending'])
})
