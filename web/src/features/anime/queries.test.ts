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
  assert.deepEqual(eighties?.variables, { from: 19799999, to: 19900000 })
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
