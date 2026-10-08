import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from './anilist.ts'
import { shouldRetry } from './queryClient.ts'

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
