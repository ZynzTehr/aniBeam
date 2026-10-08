import { dehydrate, QueryClient } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from './anilist.ts'
import { persistOptions, shouldRetry } from './queryClient.ts'

const DAY = 24 * 60 * 60 * 1000

test('retries rate limits, server errors and network failures, at most 3 times', () => {
  assert.equal(shouldRetry(0, new AniListError('Too Many Requests.', 429)), true)
  assert.equal(shouldRetry(0, new AniListError('AniList request failed (HTTP 502)', 502)), true)
  assert.equal(shouldRetry(2, new TypeError('Failed to fetch')), true)
  assert.equal(shouldRetry(3, new TypeError('Failed to fetch')), false)
})

test('never retries a bad request, which would only spend the rate limit', () => {
  assert.equal(shouldRetry(0, new AniListError('Validation error', 400)), false)
  assert.equal(shouldRetry(0, new AniListError('Not Found.', 404)), false)
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
