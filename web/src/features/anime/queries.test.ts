import { QueryClient, QueryObserver } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ERAS, eraQuery, QUERIES, searchQuery, trendingQuery } from './queries.ts'

test('every media query excludes adult titles', () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    // Checks top-level media(...) calls. Media reached through connections (relations,
    // recommendations) can't take these filters and must be filtered in code instead.
    const mediaArguments = [...query.matchAll(/\bmedia\s*\(([^)]*)\)/gi)].map((match) => match[1])
    assert.ok(mediaArguments.length > 0, `${name} has no media query`)
    for (const args of mediaArguments) {
      assert.match(args, /isAdult: false/, `${name} is missing isAdult: false`)
      assert.match(args, /genre_not_in: \["Hentai"\]/, `${name} is missing the Hentai exclusion`)
    }
  }
})

test('the 1980s cover 1980-01-01 through 1989-12-31, including year-only dates', () => {
  const eighties = ERAS.find((era) => era.id === '1980s')
  assert.deepEqual(eighties?.variables, {
    from: 19799999,
    to: 19900000,
    notStatus: 'NOT_YET_RELEASED',
  })
})

test('eras run from pre-1970 to upcoming without gaps', () => {
  assert.deepEqual(
    ERAS.map((era) => era.id),
    ['pre-1970', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s', 'upcoming'],
  )
  for (let i = 1; i < ERAS.length - 1; i++) {
    const previousEnd = ERAS[i - 1].variables.to as number
    assert.equal(
      ERAS[i].variables.from,
      previousEnd - 1,
      `${ERAS[i].id} does not start where ${ERAS[i - 1].id} ends`,
    )
  }
})

test('the search term is sent as a variable, never written into the query', async (t) => {
  const sent: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string))
    return new Response(JSON.stringify({ data: { Page: { media: [] } } }))
  })
  const term = '") { id } #'
  // The cast stands in for the context TanStack Query passes; only the signal is used.
  await searchQuery(term).queryFn!({ signal: new AbortController().signal } as never)
  assert.deepEqual(sent, [{ query: QUERIES.search, variables: { search: term } }])
})

test('each search term gets its own cache entry', () => {
  assert.notDeepEqual(searchQuery('naruto').queryKey, searchQuery('frieren').queryKey)
})

test('every era has its own cache entry', () => {
  const keys = ERAS.map((era) => JSON.stringify(eraQuery(era).queryKey))
  assert.equal(new Set(keys).size, ERAS.length)
})

test('changing the dates of an era gives it a new cache key, so old saved results are not reused', () => {
  const eighties = ERAS.find((era) => era.id === '1980s')!
  const moved = { ...eighties, variables: { ...eighties.variables, from: 19800101 } }
  assert.notDeepEqual(eraQuery(moved).queryKey, eraQuery(eighties).queryKey)
})

test('cache keys include the query text, so editing a query discards its saved results', () => {
  assert.ok(trendingQuery().queryKey.includes(QUERIES.trending))
  assert.ok(eraQuery(ERAS[0]).queryKey.includes(QUERIES.era))
  assert.ok(searchQuery('x').queryKey.includes(QUERIES.search))
})

test('searches ignore capitals and extra spaces, so they share one request', async (t) => {
  const sent: { variables: Record<string, unknown> }[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string))
    return new Response(JSON.stringify({ data: { Page: { media: [] } } }))
  })
  assert.deepEqual(
    searchQuery('  Frieren   Beyond ').queryKey,
    searchQuery('frieren beyond').queryKey,
  )
  // The cast stands in for the context TanStack Query passes; only the signal is used.
  await searchQuery('  Frieren   Beyond ').queryFn!({
    signal: new AbortController().signal,
  } as never)
  assert.deepEqual(sent[0].variables, { search: 'frieren beyond' })
})

test('Upcoming lists only unreleased titles, and the other eras leave them out', () => {
  const upcoming = ERAS.find((era) => era.id === 'upcoming')
  assert.deepEqual(upcoming?.variables, { status: 'NOT_YET_RELEASED' })
  for (const era of ERAS.filter((e) => e.id !== 'upcoming')) {
    assert.equal(
      era.variables.notStatus,
      'NOT_YET_RELEASED',
      `${era.id} includes unreleased titles`,
    )
  }
})

const decades = (...ids: string[]) => ids.map((id) => ERAS.find((era) => era.id === id)!)

test('switching lists keeps a request that was already sent, so its result is cached', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    return new Response(JSON.stringify({ data: { Page: { media: [{ id: 1 }] } } }))
  })
  const client = new QueryClient()
  t.after(() => client.clear())
  const [eighties, nineties] = decades('1980s', '1990s')

  const observer = new QueryObserver(client, eraQuery(eighties))
  const unsubscribe = observer.subscribe(() => {})
  observer.setOptions(eraQuery(nineties)) // the user picks another decade before the reply arrives
  await new Promise((resolve) => setTimeout(resolve, 50))
  unsubscribe()

  assert.deepEqual(client.getQueryData(eraQuery(eighties).queryKey), [{ id: 1 }])
})

test('while rate-limited, a request still waiting is dropped when the list changes', async (t) => {
  // A fake clock in the past, so the pause this test starts has long expired for later tests.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2000, 0, 1) })
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    sent.push(String(JSON.parse(init.body as string).variables.from ?? 'trending'))
    return sent.length === 1
      ? new Response(
          JSON.stringify({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }),
          { status: 429 },
        )
      : new Response(JSON.stringify({ data: { Page: { media: [] } } }))
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  t.after(() => client.clear())
  await client.query(trendingQuery()).catch(() => {}) // the 429 starts a one-minute pause
  const [eighties, nineties] = decades('1980s', '1990s')

  const observer = new QueryObserver(client, eraQuery(eighties)) // waits for the pause
  const unsubscribe = observer.subscribe(() => {})
  observer.setOptions(eraQuery(nineties)) // the user moves on; the 1990s wait too
  for (let second = 0; second <= 60; second++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(1000)
  }
  unsubscribe()

  assert.deepEqual(sent, ['trending', '19899999'], 'only the list still on screen was sent')
})
