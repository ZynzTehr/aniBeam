import { readdirSync, readFileSync } from 'node:fs'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  cardOf,
  ERAS,
  eraQuery,
  isRefinement,
  keptFor,
  listQuery,
  QUERIES,
  SAFE,
  searchQuery,
  titleQuery,
  trendingQuery,
  type Era,
  type Media,
} from './queries.ts'
import { tagsOf } from './tags.ts'
import { AniListError } from '../../lib/anilist.ts'
import { shouldRetry } from '../../lib/queryClient.ts'

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

// Every field of Media with a value: one item per array and no nulls, so every nested field is
// reached. It's typed as Media, so the type check fails until a field added to Media is added
// here too. The type check can't force in an optional field (`?:`), so one would go unchecked.
const complete: Media = {
  id: 1,
  title: { romaji: 'Sousou no Frieren', english: 'Frieren', native: '葬送のフリーレン' },
  coverImage: { extraLarge: 'x.png', large: 'l.png', color: '#e4a15d' },
  bannerImage: 'b.png',
  genres: ['Adventure'],
  averageScore: 90,
  format: 'TV',
  episodes: 28,
  season: 'FALL',
  seasonYear: 2023,
  studios: { nodes: [{ name: 'Madhouse' }] },
  nextAiringEpisode: { episode: 9, airingAt: 1_800_000_000 },
  description: 'The adventure is over but life goes on for an elf mage.',
  duration: 24,
  tags: [
    { name: 'Travel', rank: 96, isAdult: false, isGeneralSpoiler: false, isMediaSpoiler: false },
  ],
  trailer: { id: 'qgQMYYwHOWs', site: 'youtube' },
}

/** "studios.nodes.name" and so on: the path of every field holding a plain value. */
const fieldsOf = (value: unknown, path = ''): string[] =>
  Array.isArray(value)
    ? fieldsOf(value[0], path)
    : value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) =>
          fieldsOf(child, path ? `${path}.${key}` : key),
        )
      : [path]

/**
 * The same paths for what each media(...) or Media(...) call in a query selects, one list per call,
 * since one query can ask for several lists. Arguments are skipped, assuming none holds a
 * parenthesis, as the SAFE tests do too.
 */
const selections = (query: string) =>
  [...query.matchAll(/\b[mM]edia\s*\([^)]*\)\s*\{/g)].map((call) => {
    const tokens =
      query
        .slice(call.index + call[0].length)
        .replace(/\([^)]*\)/g, ' ')
        .match(/[{}]|\w+/g) ?? []
    const fields: string[] = []
    const parents: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '}') {
        if (!parents.length) break // the end of this media(...) call
        parents.pop()
      } else if (tokens[i + 1] === '{') parents.push(tokens[i++])
      else fields.push([...parents, tokens[i]].join('.'))
    }
    return fields.sort()
  })

// Media is typed by hand and CARD is a plain string, so the type check can't tell when they drift
// apart, and a field a query leaves out is undefined on every title it returns. Whole paths are
// compared, because a check that each name appears would still find a dropped "season" inside
// "seasonYear", or "episode" inside "episodes".
// One title on its own (Title) asks for its status too, for how long it stays fresh.
test('every query asks AniList for exactly the fields of Media, and a title alone its status too', () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    const wanted = [...fieldsOf(complete), ...(name === 'title' ? ['status'] : [])].sort()
    const calls = selections(query)
    assert.ok(calls.length > 0, `${name} has no media(...) call`)
    for (const fields of calls) {
      assert.deepEqual(fields, wanted, `${name} doesn't ask for exactly the fields it needs`)
    }
  }
})

// The test above skips arguments. Without asHtml: false, AniList turns the synopsis's line breaks
// into more HTML than synopsis.ts reads.
test('every query asks for the synopsis as AniList writes it, not as HTML', () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    const asked = [...query.matchAll(/\bdescription\b(\s*\([^)]*\))?/g)]
    assert.ok(asked.length > 0, `${name} doesn't ask for the synopsis`)
    for (const [, args] of asked) assert.equal(args, '(asHtml: false)', name)
  }
})

// Spec §5: YouTube loads only when a trailer is played. The lists carry where each title's trailer
// is, so a card knows at once whether to offer "Watch trailer", but never its thumbnail: an image
// on Google's servers (i.ytimg.com) that a card or a list would load as it showed. The test above
// would catch a thumbnail too, but only as one more field; this one says why it must stay out.
test('every query asks where a title’s trailer is, its site and id, and never for its thumbnail', () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    const calls = selections(query)
    assert.ok(calls.length > 0, `${name} has no media(...) call`)
    for (const fields of calls)
      assert.deepEqual(
        fields.filter((field) => field === 'trailer' || field.startsWith('trailer.')),
        ['trailer.id', 'trailer.site'],
        `${name} doesn't ask for exactly a trailer's id and site`,
      )
    assert.doesNotMatch(query, /thumbnail/, `${name} asks for a trailer's thumbnail`)
  }
})

const saved = JSON.parse(readFileSync(new URL('./saved-details.json', import.meta.url), 'utf8'))
/** One Piece's 75 tags as AniList sent them on 2026-10-11, saved without names, so named here. */
const onePieceTags = (): Media['tags'] =>
  saved.tags['One Piece'].map((tag: object, i: number) => ({ name: `tag ${i}`, ...tag }))

// A title in a list carries its details, so the card opens on them with no request, and keeps the
// tags it shows: of One Piece's 75, the top 8 and the top 8 spoilers (see tagsOf).
test("cardOf keeps the tags a card shows, One Piece's top 8 and top 8 spoilers, and the rest", () => {
  const media: Media = { ...complete, tags: onePieceTags() }
  const card = cardOf(media)
  assert.equal(card.tags.length, 16)
  assert.deepEqual(
    card.tags.map((tag) => tag.rank),
    [98, 94, 93, 93, 90, 88, 83, 81, 81, 79, 76, 73, 67, 65, 61, 60],
  )
  const spoils = card.tags.map((tag) => Boolean(tag.isGeneralSpoiler || tag.isMediaSpoiler))
  assert.deepEqual(spoils, [...Array(8).fill(false), ...Array(8).fill(true)])
  assert.ok(
    card.tags.every((tag) => media.tags.includes(tag)),
    'a tag changed on the way',
  )
  assert.deepEqual({ ...card, tags: complete.tags }, complete, 'another field changed')
  assert.equal(media.tags.length, 75, "cardOf cut the answer's own list")
  // A title alone keeps its status, which titleQuery's staleTime reads.
  assert.equal(cardOf({ ...media, status: 'FINISHED' }).status, 'FINISHED')
})

test('one title is asked for by its id, a number, with its own cache entry', () => {
  const { queryKey } = titleQuery(154587)
  assert.deepEqual(queryKey, ['anilist', QUERIES.title, { id: 154587 }])
  assert.notDeepEqual(titleQuery(1).queryKey, queryKey)
  assert.match(QUERIES.title, /\bMedia\(id: \$id, type: ANIME, /)
})

test('a finished title stays fresh for 30 days, an airing one for 6 hours', () => {
  const staleTime = titleQuery(1).staleTime as (query: unknown) => number
  const after = (status: string | null) => staleTime({ state: { data: { status } } })
  assert.equal(after('FINISHED'), 30 * 24 * 60 * 60_000)
  for (const status of ['RELEASING', 'NOT_YET_RELEASED', 'HIATUS', null])
    assert.equal(after(status), 6 * 60 * 60_000, String(status))
  assert.equal(staleTime({ state: { data: undefined } }), 6 * 60 * 60_000)
})

// My List (spec §3F) holds ids alone, and loads its titles in one request, by id, at most 50.
test('My List asks for its titles by id in one request of up to 50, with adult titles kept out', () => {
  const { queryKey } = listQuery([154587, 1])
  assert.deepEqual(queryKey, ['anilist', QUERIES.list, { ids: [1, 154587] }])
  assert.match(QUERIES.list, /\bPage\(perPage: 50\) \{ media\(id_in: \$ids, type: ANIME, /)
  assert.ok(QUERIES.list.includes(SAFE), 'the list query drops SAFE')
  // Not the samples' FINISHED filter: an airing title on the list must come too.
  assert.doesNotMatch(QUERIES.list, /status/)
})

// The same titles saved in another order are the same request, and the same saved answer.
test('the same ids in any order share one cache entry, and other ids get their own', () => {
  assert.deepEqual(listQuery([3, 1, 2]).queryKey, listQuery([1, 2, 3]).queryKey)
  assert.deepEqual(listQuery([10, 9]).queryKey[2], { ids: [9, 10] }, 'sorted as numbers')
  assert.notDeepEqual(listQuery([1, 2]).queryKey, listQuery([1, 2, 3]).queryKey)
  const ids = [3, 1, 2]
  listQuery(ids)
  assert.deepEqual(ids, [3, 1, 2], 'the ids handed in were sorted where they are')
})

test('My List’s titles stay fresh for 6 hours and are kept 30 days, so they show offline', () => {
  const HOUR = 60 * 60_000
  const { queryKey, staleTime } = listQuery([1, 2])
  assert.equal(staleTime, 6 * HOUR)
  assert.equal(keptFor(queryKey, []), 30 * 24 * HOUR)
  // The other lists are still kept a day.
  assert.equal(keptFor(trendingQuery().queryKey, []), 24 * HOUR)
  assert.equal(keptFor(searchQuery('frieren').queryKey, []), 24 * HOUR)
})

test('an answer with no title and no error reads as AniList’s 404 too', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: { Media: null } }))
  const asked = titleQuery(99999999).queryFn!({ signal: new AbortController().signal } as never)
  const error = await Promise.resolve(asked).then(
    () => assert.fail('an empty answer came back as found'),
    (error: unknown) => error,
  )
  assert.ok(error instanceof AniListError)
  assert.equal(error.status, 404)
})

test("a title AniList doesn't have fails as its 404, which is never retried", async (t) => {
  // AniList's answer for an id with no anime, or an adult title that SAFE keeps out.
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      { data: { Media: null }, errors: [{ message: 'Not Found.', status: 404 }] },
      { status: 404 },
    ),
  )
  const asked = titleQuery(99999999).queryFn!({ signal: new AbortController().signal } as never)
  const error = await Promise.resolve(asked).then(
    () => assert.fail('a missing title came back as found'),
    (error: unknown) => error,
  )
  assert.ok(error instanceof AniListError)
  assert.equal(error.status, 404)
  assert.equal(shouldRetry(0, error), false)
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

type Sent = { query: string; variables: Record<string, unknown> }
// AniList's answer to a request for both of a first visit's lists. Its titles, and those of the
// answers below, are an id and an empty list of tags, so that each list caches them just as they
// came: cardOf changes only a title's tags.
const both = {
  data: { trending: { media: [{ id: 1, tags: [] }] }, era: { media: [{ id: 2, tags: [] }] } },
}

/** Sets up trending and a decade the way App does: both built first, then both subscribed. */
function page(client: QueryClient, era: Era) {
  const observers = [trendingQuery(), eraQuery(era)].map(
    (options) => new QueryObserver(client, options),
  )
  const stops = observers.map((observer) => observer.subscribe(() => {}))
  return { decade: observers[1], leave: () => stops.forEach((stop) => stop()) }
}

// The page opens on trending and the 1990s. AniList allows 30 requests a minute per IP address,
// and a class on one school Wi-Fi shares one, so a first visit asks for both lists at once.
test('a first visit asks AniList for trending and the 1990s in one request', async (t) => {
  const sent: Sent[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string))
    return new Response(JSON.stringify(both))
  })
  const client = new QueryClient()
  t.after(() => client.clear())
  const [nineties] = decades('1990s')
  const { leave } = page(client, nineties)
  await new Promise((resolve) => setTimeout(resolve, 50))
  leave()

  assert.equal(sent.length, 1, `sent ${sent.length} requests`)
  assert.deepEqual(sent[0].variables, nineties.variables, 'it asks for another decade')
  for (const name of Object.keys(sent[0].variables)) {
    assert.ok(
      sent[0].query.includes(`$${name}:`),
      `sends $${name}, which its query doesn't declare`,
    )
  }
  assert.deepEqual(client.getQueryData(trendingQuery().queryKey), [{ id: 1, tags: [] }])
  assert.deepEqual(client.getQueryData(eraQuery(nineties).queryKey), [{ id: 2, tags: [] }])
})

test('every list, and a title alone, is cached with only the tags its card shows', async (t) => {
  const answer = { ...complete, tags: onePieceTags() }
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      data: {
        Page: { media: [answer] },
        trending: { media: [answer] },
        era: { media: [answer] },
        Media: answer,
      },
    }),
  )
  // The title as the card shows it, worked out here from tagsOf itself, not from cardOf.
  const { shown, spoilers } = tagsOf(answer.tags)
  const cut = { ...answer, tags: [...shown, ...spoilers] }
  assert.equal(cut.tags.length, 16)
  const signal = new AbortController().signal
  for (const options of [
    trendingQuery(),
    ...ERAS.map((era) => eraQuery(era)),
    searchQuery('one piece'),
  ]) {
    // The cast stands in for the context TanStack Query passes; only the signal is used.
    const titles = await options.queryFn!({ signal } as never)
    assert.deepEqual(titles, [cut], JSON.stringify(options.queryKey[2]))
  }
  assert.deepEqual(await titleQuery(21).queryFn!({ signal } as never), cut, 'a title alone')
  // A first visit's request for both lists, which fills each list's cache entry.
  const client = new QueryClient()
  t.after(() => client.clear())
  const [nineties] = decades('1990s')
  const { leave } = page(client, nineties)
  await new Promise((resolve) => setTimeout(resolve, 50))
  leave()
  assert.deepEqual(client.getQueryData(trendingQuery().queryKey), [cut], 'a first visit’s trending')
  assert.deepEqual(client.getQueryData(eraQuery(nineties).queryKey), [cut], 'its 1990s')
})

test('with one of those lists saved, the other is asked for on its own', async (t) => {
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string).query)
    return new Response(JSON.stringify({ data: { Page: { media: [{ id: 3, tags: [] }] } } }))
  })
  const [nineties] = decades('1990s')
  // A returning visitor's saved list, and the one the page must then ask for.
  for (const [saved, asked] of [
    ['trending', QUERIES.era],
    ['the 1990s', QUERIES.trending],
  ]) {
    sent.length = 0
    const client = new QueryClient()
    const { queryKey } = saved === 'trending' ? trendingQuery() : eraQuery(nineties)
    client.setQueryData(queryKey, [complete])
    const { leave } = page(client, nineties)
    await new Promise((resolve) => setTimeout(resolve, 50))
    leave()
    client.clear()
    assert.deepEqual(sent, [asked], `with ${saved} saved`)
  }
})

test('a decade picked while a first visit loads asks for its own titles', async (t) => {
  const sent: Sent[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request: Sent = JSON.parse(init.body as string)
    sent.push(request)
    const answer = request.query.includes('trending:')
      ? both
      : { data: { Page: { media: [{ id: 4, tags: [] }] } } }
    return new Response(JSON.stringify(answer))
  })
  const client = new QueryClient()
  t.after(() => client.clear())
  const [eighties, nineties] = decades('1980s', '1990s')
  const { decade, leave } = page(client, nineties)
  decade.setOptions(eraQuery(eighties)) // the visitor picks the 1980s before the answer
  await new Promise((resolve) => setTimeout(resolve, 50))
  leave()

  assert.deepEqual(
    client.getQueryData(eraQuery(eighties).queryKey),
    [{ id: 4, tags: [] }],
    'the 1980s got another list',
  )
  assert.deepEqual(sent.at(-1), { query: QUERIES.era, variables: eighties.variables })
})

test('when that request fails, both lists retry it together, still one request a try', async (t) => {
  // Fake timers skip TanStack's wait before the retry.
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: Sent[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string))
    return sent.length === 1
      ? new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: 'Internal Server Error', status: 500 }],
          }),
          { status: 500 },
        )
      : new Response(JSON.stringify(both))
  })
  // Node counts as a server, where TanStack retries nothing unless told to.
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
  t.after(() => client.clear())
  const [nineties] = decades('1990s')
  const { leave } = page(client, nineties)
  for (let step = 0; step < 40; step++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(100)
  }
  leave()

  assert.equal(sent.length, 2, `sent ${sent.length} requests over two tries`)
  assert.deepEqual(client.getQueryData(trendingQuery().queryKey), [{ id: 1, tags: [] }])
  assert.deepEqual(client.getQueryData(eraQuery(nineties).queryKey), [{ id: 2, tags: [] }])
})

test('switching lists keeps a request that was already sent, so its result is cached', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    return new Response(JSON.stringify({ data: { Page: { media: [{ id: 1, tags: [] }] } } }))
  })
  const client = new QueryClient()
  t.after(() => client.clear())
  const [eighties, nineties] = decades('1980s', '1990s')

  const observer = new QueryObserver(client, eraQuery(eighties))
  const unsubscribe = observer.subscribe(() => {})
  observer.setOptions(eraQuery(nineties)) // the user picks another decade before the reply arrives
  await new Promise((resolve) => setTimeout(resolve, 50))
  unsubscribe()

  assert.deepEqual(client.getQueryData(eraQuery(eighties).queryKey), [{ id: 1, tags: [] }])
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

// The request for both of a first visit's lists reads no abort signal (see mediaQuery). If it took
// the signal of the list that asked first, leaving that list would cancel the other's half too.
// App asks for trending first and always shows it, so here the 1990s ask first, while requests
// are held for a rate limit: the only time a list's own request reads its signal.
test("while rate-limited, leaving the 1990s on a first visit doesn't cancel trending", async (t) => {
  // A fake clock in the past, so the pause this test starts has long expired for later tests,
  // and a day after the test above's, whose pause (until 2000-01-01 00:01) would hold this one.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2000, 0, 2) })
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    // As fetch does, a request whose signal was aborted while it waited is refused.
    if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError')
    const { query } = JSON.parse(init.body as string)
    if (query === QUERIES.search) {
      return new Response(
        JSON.stringify({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }),
        { status: 429 },
      )
    }
    // The request for both lists, or the 1980s' own.
    return new Response(
      JSON.stringify(query === QUERIES.firstVisit ? both : { data: { Page: { media: [] } } }),
    )
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  t.after(() => client.clear())
  // A search's 429 starts a one-minute pause, before either list has been asked for.
  await client.query(searchQuery('frieren')).catch(() => {})
  const [eighties, nineties] = decades('1980s', '1990s')

  // Both lists are built before either asks, as page() does, but the 1990s ask first.
  const decade = new QueryObserver(client, eraQuery(nineties))
  const trending = new QueryObserver(client, trendingQuery())
  const stops = [decade, trending].map((observer) => observer.subscribe(() => {}))
  decade.setOptions(eraQuery(eighties)) // the visitor picks the 1980s before the request is sent
  for (let second = 0; second <= 60; second++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(1000)
  }
  stops.forEach((stop) => stop())

  assert.deepEqual(
    client.getQueryData(trendingQuery().queryKey),
    [{ id: 1, tags: [] }],
    "leaving the 1990s also cancelled trending's half of their request",
  )
})

test('every media query anywhere in the source uses SAFE', () => {
  // Also catches a query written outside QUERIES, such as one inline in a future feature.
  const src = new URL('../../', import.meta.url)
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
    (file) => /\.tsx?$/.test(file) && !file.includes('.test.'),
  )
  let calls = 0
  for (const file of files) {
    // Comments may mention media(...) without being queries.
    const code = readFileSync(new URL(file, src), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    for (const [, args] of code.matchAll(/\bmedia\s*\(([^)]*)\)/gi)) {
      calls++
      assert.match(args, /\$\{SAFE\}/, `${file}: media(${args}) is missing SAFE`)
    }
  }
  assert.ok(calls >= 3, `found only ${calls} media queries`)
})

test('every variable a query sends is declared by that query', async (t) => {
  // GraphQL ignores undeclared variables, so a renamed one would silently stop filtering.
  const sent: { query: string; variables: Record<string, unknown> }[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string))
    // A list for the lists, a title for the title on its own.
    return new Response(JSON.stringify({ data: { Page: { media: [] }, Media: { id: 1 } } }))
  })
  for (const options of [
    trendingQuery(),
    ...ERAS.map((era) => eraQuery(era)),
    searchQuery('frieren'),
    titleQuery(154587),
    listQuery([154587, 1]),
  ]) {
    // The cast stands in for the context TanStack Query passes; only the signal is used.
    await options.queryFn!({ signal: new AbortController().signal } as never)
  }
  assert.equal(sent.length, ERAS.length + 4)
  for (const { query, variables } of sent) {
    for (const name of Object.keys(variables)) {
      assert.ok(query.includes(`$${name}:`), `sends $${name}, which its query doesn't declare`)
    }
  }
})

// While a search loads, its previous titles stay on screen only if the visitor is refining
// the same search. A different search must not show another search's titles.
test('isRefinement tells refining a search from starting a new one', () => {
  assert.equal(isRefinement('frier', 'frieren'), true) // typing on
  assert.equal(isRefinement('frieren', 'frier'), true) // deleting letters
  assert.equal(isRefinement('frieren', 'frieren beyond'), true)
  assert.equal(isRefinement('frieren', 'mushishi'), false) // typed over
  assert.equal(isRefinement('', 'mushishi'), false) // no previous search
})
