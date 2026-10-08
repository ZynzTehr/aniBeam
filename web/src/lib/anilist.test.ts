import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { anilist, retryAt } from './anilist.ts'

const DAY = 24 * 60 * 60 * 1000

// anilist() keeps its rate-limit pause between calls. Every test that calls it uses a
// fake clock that starts a day after the previous test's, so a pause can't leak between tests.
let clock = Date.UTC(2030, 0, 1)
function fakeClock(t: TestContext) {
  clock += DAY
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock })
  return clock
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> }

// AniList is an external API, so fetch answers with scripted replies, in order
// (the last one repeats). Returns the fake-clock time of every request sent.
function replies(t: TestContext, ...list: Reply[]) {
  const sentAt: number[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sentAt.push(Date.now())
    const {
      status = 200,
      body = { data: { ok: true } },
      headers = {},
    } = list[Math.min(sentAt.length, list.length) - 1]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
  })
  return sentAt
}

const tooMany = (resetSeconds: number): Reply => ({
  status: 429,
  body: { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] },
  headers: { 'X-RateLimit-Reset': String(resetSeconds) },
})

// Lets promises that are ready run before the next assertion.
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('retryAt trusts a reset time within the next minute', () => {
  assert.equal(retryAt(new Headers({ 'X-RateLimit-Reset': '1030' }), 1_000_000), 1_030_000)
})

test('retryAt waits one minute when the reset header is missing', () => {
  assert.equal(retryAt(new Headers(), 1_000_000), 1_060_000)
})

test('retryAt waits one minute when the reset time has passed (computer clock fast)', () => {
  assert.equal(retryAt(new Headers({ 'X-RateLimit-Reset': '900' }), 1_000_000), 1_060_000)
})

test('retryAt waits one minute, not ten, when the computer clock is slow', () => {
  assert.equal(retryAt(new Headers({ 'X-RateLimit-Reset': '1600' }), 1_000_000), 1_060_000)
})

test('returns the data field of a successful response', async (t) => {
  fakeClock(t)
  replies(t, { body: { data: { Page: { media: [{ id: 1 }] } } } })
  assert.deepEqual(await anilist('query { x }'), { Page: { media: [{ id: 1 }] } })
})

test('throws the GraphQL error message even when HTTP status is 200', async (t) => {
  fakeClock(t)
  replies(t, { body: { data: null, errors: [{ message: 'Validation error', status: 400 }] } })
  await assert.rejects(anilist('query { x }'), {
    name: 'AniListError',
    message: 'Validation error',
    status: 400,
  })
})

test('an HTML error page becomes a readable error', async (t) => {
  fakeClock(t)
  replies(t, { status: 502, body: '<html><body>Bad Gateway</body></html>' })
  await assert.rejects(anilist('query { x }'), {
    name: 'AniListError',
    message: 'AniList request failed (HTTP 502)',
    status: 502,
  })
})

test('after a 429, the next request waits until the limit resets', async (t) => {
  const start = fakeClock(t)
  const sentAt = replies(t, tooMany(start / 1000 + 30), {})
  await assert.rejects(anilist('query { x }'), { status: 429, retryAt: start + 30_000 })

  const next = anilist('query { x }')
  t.mock.timers.tick(29_999)
  await settle()
  assert.equal(sentAt.length, 1, 'the second request went out before the limit reset')

  t.mock.timers.tick(1)
  assert.deepEqual(await next, { ok: true })
  assert.deepEqual(sentAt, [start, start + 30_000])
})

test('after the last request of the minute, the next request waits a minute', async (t) => {
  const start = fakeClock(t)
  const sentAt = replies(t, { headers: { 'X-RateLimit-Remaining': '0' } }, {})
  await anilist('query { x }')

  const next = anilist('query { x }')
  t.mock.timers.tick(59_999)
  await settle()
  assert.equal(sentAt.length, 1, 'the second request went out before the minute was up')

  t.mock.timers.tick(1)
  await next
  assert.deepEqual(sentAt, [start, start + 60_000])
})

test('a waiting request keeps waiting when the pause gets longer', async (t) => {
  const start = fakeClock(t)
  // Request A is still in flight when request B gets a 429 that resets in 10 s, so C waits.
  // Then A finishes with no requests left this minute, which extends the pause by a minute.
  let finishA!: (response: Response) => void
  const sentAt: number[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sentAt.push(Date.now())
    if (sentAt.length === 1) return new Promise<Response>((resolve) => (finishA = resolve))
    if (sentAt.length === 2) {
      const reply = tooMany(start / 1000 + 10)
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: reply.headers,
      })
    }
    return new Response(JSON.stringify({ data: { ok: true } }))
  })

  const a = anilist('query { a }')
  await assert.rejects(anilist('query { b }'), { status: 429 })
  const c = anilist('query { c }')

  t.mock.timers.tick(5_000)
  finishA(
    new Response(JSON.stringify({ data: { ok: true } }), {
      headers: { 'X-RateLimit-Remaining': '0' },
    }),
  )
  await a

  t.mock.timers.tick(5_000) // B's 10-second pause is over, but A's minute is not
  await settle()
  assert.equal(sentAt.length, 2, 'C went out before the extended pause ended')

  t.mock.timers.tick(55_000)
  await c
  assert.deepEqual(sentAt, [start, start, start + 65_000])
})

test('a failed connection pauses later requests for a minute', async (t) => {
  // AniList's burst limiter can answer 429 without CORS headers. The browser then
  // reports only a network failure (TypeError), so it is treated like a rate limit.
  const start = fakeClock(t)
  const sentAt: number[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sentAt.push(Date.now())
    if (sentAt.length === 1) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify({ data: { ok: true } }))
  })
  await assert.rejects(anilist('query { x }'), TypeError)

  const next = anilist('query { x }')
  t.mock.timers.tick(59_999)
  await settle()
  assert.equal(sentAt.length, 1, 'the second request went out before the minute was up')

  t.mock.timers.tick(1)
  await next
  assert.deepEqual(sentAt, [start, start + 60_000])
})

test('a cancelled request does not pause the next one', async (t) => {
  // Typing more cancels the previous search; that must never freeze the app.
  const start = fakeClock(t)
  const sentAt: number[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sentAt.push(Date.now())
    if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    return new Response(JSON.stringify({ data: { ok: true } }))
  })
  await assert.rejects(anilist('query { x }', {}, AbortSignal.abort()), { name: 'AbortError' })
  assert.deepEqual(await anilist('query { x }'), { ok: true })
  assert.deepEqual(sentAt, [start, start])
})
