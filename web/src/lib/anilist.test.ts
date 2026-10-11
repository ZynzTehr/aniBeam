import assert from 'node:assert/strict'
import { beforeEach, test, type TestContext } from 'node:test'
import { anilist, retryAt } from './anilist.ts'

const DAY = 24 * 60 * 60 * 1000

// anilist() keeps its rate-limit pause between calls, so every test runs on a fake clock
// that starts a day after the previous test's; a pause can't leak into the next test.
let clock = Date.UTC(2030, 0, 1)
beforeEach((t) => {
  const context = t as TestContext
  clock += DAY
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock })
})

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
  assert.equal(
    retryAt(new Headers({ 'X-RateLimit-Reset': '1030' }), 1_000_000, () => 0),
    1_030_000,
  )
})

// Every device on one network shares one limit, and so one reset time. Up to 2 seconds more,
// picked at random, keeps them from all asking again in the same instant.
test('retryAt spreads retries over the 2 seconds after a reset time', () => {
  const headers = new Headers({ 'X-RateLimit-Reset': '1030' })
  // How many ms after the reset the pause ends when random() returns the given number
  const spread = (random: number) => retryAt(headers, 1_000_000, () => random) - 1_030_000

  assert.equal(spread(0), 0, `random 0 ended the pause ${spread(0)} ms after the reset, not at it`)
  const most = spread(0.999)
  assert.ok(
    most > 1_990 && most <= 2_000,
    `random 0.999 ended the pause ${most} ms after the reset, not about 2 s`,
  )
  for (const random of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    assert.ok(spread(random) >= 0, `random ${random} ended the pause before the reset`)
  }
  // The full minute counts from each device's own reply, so their times already differ.
  assert.equal(
    retryAt(new Headers(), 1_000_000, () => 0.999),
    1_060_000,
    'the full minute got a spread too',
  )
  // The spread goes on only after the reset time is trusted. Added before that check, it could
  // push a reset that passed up to 2 s ago into the next minute, where it would be trusted, and
  // the pause would end within 2 s instead of after the full minute.
  assert.equal(
    retryAt(new Headers({ 'X-RateLimit-Reset': '999' }), 1_000_000, () => 0.999),
    1_060_000,
    'a reset 1 s ago was trusted, so the pause ended within 2 s, not after a minute',
  )
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
  replies(t, { body: { data: { Page: { media: [{ id: 1 }] } } } })
  assert.deepEqual(await anilist('query { x }'), { Page: { media: [{ id: 1 }] } })
})

test('throws the GraphQL error message even when HTTP status is 200', async (t) => {
  replies(t, { body: { data: null, errors: [{ message: 'Validation error', status: 400 }] } })
  await assert.rejects(anilist('query { x }'), {
    name: 'AniListError',
    message: 'Validation error',
    status: 400,
  })
})

test('an HTML error page becomes a readable error', async (t) => {
  replies(t, { status: 502, body: '<html><body>Bad Gateway</body></html>' })
  await assert.rejects(anilist('query { x }'), {
    name: 'AniListError',
    message: 'AniList request failed (HTTP 502)',
    status: 502,
  })
})

test('after a 429, the next request waits until the limit resets, plus its spread', async (t) => {
  t.mock.method(Math, 'random', () => 0.5) // a 1 s spread, half the most
  const start = Date.now()
  const sentAt = replies(t, tooMany(start / 1000 + 30), {})
  await assert.rejects(anilist('query { x }'), { status: 429, retryAt: start + 31_000 })

  const next = anilist('query { x }')
  t.mock.timers.tick(30_999)
  await settle()
  assert.equal(sentAt.length, 1, 'the second request went out before the reset plus its spread')

  t.mock.timers.tick(1)
  assert.deepEqual(await next, { ok: true })
  assert.deepEqual(sentAt, [start, start + 31_000])
})

test('after the last request of the minute, the next request waits a minute', async (t) => {
  const start = Date.now()
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
  // No spread, so B's pause ends exactly 10 s in and C wakes up between the ticks below. With
  // a spread, C would first wake inside the 55 s tick, and a C that looked only once would pass.
  t.mock.method(Math, 'random', () => 0)
  const start = Date.now()
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
  const start = Date.now()
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
  const start = Date.now()
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

test('sends one JSON POST with the query and variables to AniList', async (t) => {
  const calls: [string, RequestInit][] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push([url, init])
    return new Response(JSON.stringify({ data: { ok: true } }))
  })
  const signal = new AbortController().signal
  await anilist('query ($id: Int) { x }', { id: 7 }, signal)

  assert.equal(calls.length, 1)
  const [url, init] = calls[0]
  assert.equal(url, 'https://graphql.anilist.co')
  assert.equal(init.method, 'POST')
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', Accept: 'application/json' })
  assert.equal(init.body, '{"query":"query ($id: Int) { x }","variables":{"id":7}}')
  assert.equal(init.signal, signal)
})
