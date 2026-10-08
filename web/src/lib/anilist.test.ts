import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { anilist, AniListError, retryAt } from './anilist.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// AniList is an external API, so these tests replace fetch with a canned response.
function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers })
}

test('retryAt uses X-RateLimit-Reset (Unix seconds) when present', () => {
  const headers = new Headers({ 'X-RateLimit-Reset': '1760000000' })
  assert.equal(retryAt(headers, 5_000), 1_760_000_000_000)
})

test('retryAt waits one minute when the reset header is missing', () => {
  assert.equal(retryAt(new Headers(), 5_000), 65_000)
})

test('returns the data field of a successful response', async () => {
  respond(200, { data: { Page: { media: [{ id: 1 }] } } })
  assert.deepEqual(await anilist('query { x }'), { Page: { media: [{ id: 1 }] } })
})

test('throws the GraphQL error message even when HTTP status is 200', async () => {
  respond(200, { data: null, errors: [{ message: 'Validation error', status: 400 }] })
  await assert.rejects(anilist('query { x }'), {
    name: 'AniListError',
    message: 'Validation error',
    status: 400,
  })
})

test('a 429 response reports when requests may resume', async () => {
  // A reset time in the past keeps later tests from waiting.
  respond(
    429,
    { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
    { 'X-RateLimit-Reset': '1000' },
  )
  await assert.rejects(anilist('query { x }'), (error) => {
    assert.ok(error instanceof AniListError)
    assert.equal(error.status, 429)
    assert.equal(error.retryAt, 1_000_000)
    return true
  })
})
