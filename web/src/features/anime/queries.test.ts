import { readdirSync, readFileSync } from 'node:fs'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import {
  cardOf,
  ERAS,
  eraQuery,
  isRefinement,
  keptFor,
  listQuery,
  poolOf,
  poolQuery,
  poolTitleOf,
  QUERIES,
  SAFE,
  searchQuery,
  titleQuery,
  trendingQuery,
  wantPool,
  type Era,
  type Media,
  type Pool,
  type PoolAnswer,
} from './queries.ts'
import { tagsOf } from './tags.ts'
import { AniListError } from '../../lib/anilist.ts'
import { shouldRetry } from '../../lib/queryClient.ts'
import { moodScoring } from '../mood/loadScoring.ts'
import { MOOD_MAP, MOOD_TAGS } from '../mood/moodMap.ts'

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

/** A pool title with every field set, as `complete` is: Media's, and its relations (PoolAnswer). */
const completePool: PoolAnswer = {
  ...complete,
  relations: { edges: [{ relationType: 'SEQUEL', node: { id: 2, type: 'ANIME' } }] },
}

// Media is typed by hand and CARD is a plain string, so the type check can't tell when they drift
// apart, and a field a query leaves out is undefined on every title it returns. Whole paths are
// compared, because a check that each name appears would still find a dropped "season" inside
// "seasonYear", or "episode" inside "episodes".
// One title on its own (Title) asks for its status too, for how long it stays fresh, and a mood
// pool's two pages (PoolAnswer) its relations, for the seasons a roll skips.
test('every query asks AniList for exactly the fields of Media, and a title alone its status too', () => {
  const pool = fieldsOf(completePool).sort()
  for (const [name, query] of Object.entries(QUERIES)) {
    const media = [...fieldsOf(complete), ...(name === 'title' ? ['status'] : [])].sort()
    const calls = selections(query)
    assert.ok(calls.length > 0, `${name} has no media(...) call`)
    const wanted =
      name === 'pool'
        ? [pool, pool]
        : name === 'decadeWithPool'
          ? [media, pool, pool]
          : calls.map(() => media)
    assert.deepEqual(calls, wanted, `${name} doesn't ask for exactly the fields it needs`)
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

/** A tag of AniList's, not a spoiler or adult unless `flags` say so. */
const tag = (name: string, rank: number, flags: Partial<Media['tags'][number]> = {}) => ({
  name,
  rank,
  isAdult: false,
  isGeneralSpoiler: false,
  isMediaSpoiler: false,
  ...flags,
})

/** A pool title with `tags`, `edges` for its relations, and `media`'s other fields. */
const poolTitle = (
  media: Partial<PoolAnswer>,
  edges: NonNullable<PoolAnswer['relations']>['edges'] = [],
): PoolAnswer => ({ ...complete, relations: { edges }, ...media })

test('the mood pool keeps the tags every slider’s ends name, the mood map’s, and no others', () => {
  const named = Object.values(MOOD_MAP).flatMap(({ low, high }) => [...low.tags, ...high.tags])
  assert.deepEqual([...MOOD_TAGS].sort(), [...new Set(named)].sort())
  // Every name at rank 1, below any card's top 8, with one the map doesn't name.
  const tags = [...MOOD_TAGS, 'Not on the map'].map((name) => tag(name, 1))
  const kept = poolTitleOf(poolTitle({ tags }), MOOD_TAGS).tags.map((tag) => tag.name)
  assert.deepEqual(kept.toSorted(), [...MOOD_TAGS].sort(), 'not every mood map tag, or one more')
})

// The pool ranks a decade's titles by every mood map tag they have (spec §3C), and spoilers count
// toward the score, as they say what a title is like (Tragedy is always one; see score.ts). So it
// keeps more of a title's tags than a card: of One Piece's 75, its card's 16 (see cardOf), and a
// spoiler Tragedy ranked 55, below its card's top 8 spoilers (the last at 60), and an Iyashikei
// ranked 12. Not the 59 others, nor an adult Gore, which never counts toward the score.
test("a pool title keeps its card's tags and the mood map's beyond them, spoilers too, no others", () => {
  const tragedy = tag('Tragedy', 55, { isMediaSpoiler: true })
  const iyashikei = tag('Iyashikei', 12)
  const gore = tag('Gore', 40, { isAdult: true })
  const answer = onePieceTags()
  answer.splice(10, 0, tragedy)
  answer.push(iyashikei, gore, tag('Not on the map', 30))
  const card = new Set(cardOf({ ...complete, tags: answer }).tags)
  const pool = poolTitleOf(poolTitle({ tags: answer }), MOOD_TAGS)
  assert.equal(pool.tags.length, 18, `kept ${pool.tags.length} tags, not 16 + 2`)
  assert.deepEqual(
    pool.tags,
    answer.filter((tag) => card.has(tag) || tag === tragedy || tag === iyashikei),
    'not the card’s tags, Tragedy and Iyashikei, in AniList’s order',
  )
  // So a match or a roll opens a card that shows what a card from the lists would.
  assert.deepEqual(tagsOf(pool.tags), tagsOf(answer), 'its card would show other tags')
  const { relations, ...media } = poolTitle({ tags: answer })
  assert.ok(relations, 'the stand-in has no relations')
  assert.deepEqual(
    { ...pool, tags: answer, seasons: [] },
    { ...media, seasons: [] },
    'another field changed',
  )
})

// The user's choice, B2 b: a roll skips a title when another season of it came up lately. A
// season is another anime linked as its prequel or sequel; a side story, a film's source manga or
// a title AniList leaves out (null) is not.
test('a pool title keeps its anime prequels and sequels as its seasons, by id, and no other link', () => {
  const pool = poolTitleOf(
    poolTitle({}, [
      { relationType: 'PREQUEL', node: { id: 10, type: 'ANIME' } },
      { relationType: 'SIDE_STORY', node: { id: 11, type: 'ANIME' } },
      { relationType: 'SEQUEL', node: { id: 12, type: 'MANGA' } },
      { relationType: 'SOURCE', node: { id: 13, type: 'MANGA' } },
      { relationType: 'SEQUEL', node: null },
      { relationType: null, node: { id: 14, type: 'ANIME' } },
      { relationType: 'SEQUEL', node: { id: 15, type: 'ANIME' } },
    ]),
    MOOD_TAGS,
  )
  assert.deepEqual(pool.seasons, [10, 15])
  assert.ok(!('relations' in pool), 'the relations themselves are kept too')
  assert.deepEqual(poolTitleOf({ ...completePool, relations: null }, MOOD_TAGS).seasons, [])
})

// Spec §3G keeps Ecchi out of the mood pool. Page 3 is asked for only when there is one (A12): not
// when the two pages brought fewer than 100 titles, or page 2 says it is the last.
test('a pool leaves out Ecchi titles and one sent twice, and keeps the count and page 2’s hasNextPage', () => {
  const page = (ids: number[], hasNextPage: boolean, genres = ['Comedy']) => ({
    pageInfo: { hasNextPage },
    media: ids.map((id) => poolTitle({ id, genres })),
  })
  const ecchi = page([3], true, ['Comedy', 'Ecchi'])
  const pool: Pool = poolOf(
    {
      p1: { ...page([1, 2], true), media: [...page([1, 2], true).media, ...ecchi.media] },
      p2: page([2, 4], false),
    },
    MOOD_TAGS,
  )
  assert.deepEqual(
    pool.titles.map((media) => media.id),
    [1, 2, 4],
  )
  assert.equal(pool.count, 5, 'not every title AniList sent')
  assert.equal(pool.hasNextPage, false, 'not page 2’s hasNextPage')
  assert.equal(poolOf({ p1: page([1], false), p2: page([2], true) }, MOOD_TAGS).hasNextPage, true)
})

// A slider moved must cost no request (spec §1), so the pool's key is the decade alone.
test('each decade’s pool has a key of its own, the decade alone, fresh 6 hours and kept a day', () => {
  const HOUR = 60 * 60_000
  assert.equal(poolQuery.length, 1, 'poolQuery takes more than the decade')
  for (const era of ERAS) {
    const options = poolQuery(era)
    assert.deepEqual(options.queryKey, ['anilist', QUERIES.pool, era.variables], era.id)
    assert.equal(options.staleTime, 6 * HOUR, era.id)
    assert.equal(options.refetchOnWindowFocus, false, `${era.id} refreshes on coming back`)
    assert.equal(keptFor(options.queryKey, { titles: [] }), 24 * HOUR, era.id)
  }
  const keys = ERAS.map((era) => JSON.stringify(poolQuery(era).queryKey))
  assert.equal(new Set(keys).size, ERAS.length)
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
  assert.ok(poolQuery(ERAS[0]).queryKey.includes(QUERIES.pool))
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

// AniList's answer to a request for a decade's page and its pool both (decadeWithPool), or to the
// page alone or the pool alone, each with one title, and the pool with no page after it.
const POOL_PAGE = { pageInfo: { hasNextPage: false }, media: [] }
const answerTo = (query: string) =>
  query === QUERIES.decadeWithPool
    ? { data: { era: { media: [{ id: 5, tags: [] }] }, p1: POOL_PAGE, p2: POOL_PAGE } }
    : query === QUERIES.pool
      ? { data: { p1: POOL_PAGE, p2: POOL_PAGE } }
      : query === QUERIES.firstVisit
        ? both
        : { data: { Page: { media: [{ id: 6, tags: [] }] } } }

/** A fetch that answers each request (see answerTo), and keeps what it sent. */
function answering(t: TestContext) {
  const sent: Sent[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request: Sent = JSON.parse(init.body as string)
    sent.push(request)
    return Response.json(answerTo(request.query))
  })
  return sent
}

/** Until each observer's query has stopped fetching. */
const settled = (...observers: QueryObserver<any, any, any, any, any>[]) =>
  Promise.all(
    observers.map(
      (observer) =>
        new Promise<void>((resolve) => {
          const check = () => observer.getCurrentResult().fetchStatus === 'idle' && resolve()
          observer.subscribe(check)
          check()
        }),
    ),
  )

// The machine holds the open decade's pool in the cache from the first draw, asking for it only
// once it is wanted, so a decade picked with every slider at No preference is its page's own
// request, unchanged: neither the pool's query in the cache nor another decade's pool wanted makes
// it ask for its pool.
test('a decade picked with its pool not wanted asks for its own page alone, as before', async (t) => {
  const sent = answering(t)
  const client = new QueryClient()
  t.after(() => client.clear())
  const [eighties, nineties] = decades('1980s', '1990s')
  wantPool(client, nineties)
  const pool = new QueryObserver(client, { ...poolQuery(eighties), enabled: false })
  const page = new QueryObserver(client, eraQuery(eighties))
  const stops = [pool, page].map((observer) => observer.subscribe(() => {}))
  await settled(page)
  stops.forEach((stop) => stop())
  assert.deepEqual(sent, [{ query: QUERIES.era, variables: eighties.variables }])
  assert.deepEqual(client.getQueryData(eraQuery(eighties).queryKey), [{ id: 6, tags: [] }])
  assert.equal(client.getQueryData(poolQuery(eighties).queryKey), undefined)
})

// With the decade's page cached (picked earlier, before a slider was set), the pool goes alone.
test('a pool wanted for a decade whose page is cached asks for the pool alone', async (t) => {
  const sent = answering(t)
  const client = new QueryClient()
  t.after(() => client.clear())
  const [eighties] = decades('1980s')
  client.setQueryData(eraQuery(eighties).queryKey, [complete])
  const page = new QueryObserver(client, eraQuery(eighties))
  const pool = new QueryObserver(client, poolQuery(eighties))
  const stops = [pool, page].map((observer) => observer.subscribe(() => {}))
  await settled(pool, page)
  stops.forEach((stop) => stop())
  assert.deepEqual(sent, [{ query: QUERIES.pool, variables: eighties.variables }])
})

// A pool asked for alone isn't asked for again by its page: a page asking again meanwhile (its
// titles marked out of date) asks for its own titles alone.
test('a decade’s page asked for again while its pool is asked for alone asks alone', async (t) => {
  const sent = answering(t)
  const client = new QueryClient()
  t.after(() => client.clear())
  const [eighties] = decades('1980s')
  client.setQueryData(eraQuery(eighties).queryKey, [complete])
  const page = new QueryObserver(client, eraQuery(eighties))
  const pool = new QueryObserver(client, poolQuery(eighties))
  const stops = [pool, page].map((observer) => observer.subscribe(() => {}))
  void page.refetch()
  await settled(pool, page)
  stops.forEach((stop) => stop())
  assert.deepEqual(
    sent.map(({ query }) => query).sort(),
    [QUERIES.era, QUERIES.pool].sort(),
    'the pool was asked for twice',
  )
})

// A first visit's lists come in their own request (see bothLists), whatever the machine holds: the
// 1990s' pool in the cache with no answer must not draw the 1990s away from trending.
test('a first visit still asks for trending and the 1990s in one request, with their pool held', async (t) => {
  const sent = answering(t)
  const client = new QueryClient()
  t.after(() => client.clear())
  const [nineties] = decades('1990s')
  const pool = new QueryObserver(client, { ...poolQuery(nineties), enabled: false })
  const stopPool = pool.subscribe(() => {})
  const { decade, leave } = page(client, nineties)
  await settled(decade)
  leave()
  stopPool()
  assert.deepEqual(sent, [{ query: QUERIES.firstVisit, variables: nineties.variables }])
})

// As with a first visit's request (see the test above it), a failed request for a decade's page
// and its pool is tried again by both together, still one request a try.
test('when a decade’s page and pool fail together, they retry together, one request a try', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: Sent[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request: Sent = JSON.parse(init.body as string)
    sent.push(request)
    return sent.length === 1
      ? Response.json(
          { data: null, errors: [{ message: 'Internal Server Error', status: 500 }] },
          { status: 500 },
        )
      : Response.json(answerTo(request.query))
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
  t.after(() => client.clear())
  const [eighties] = decades('1980s')
  const page = new QueryObserver(client, eraQuery(eighties))
  const pool = new QueryObserver(client, poolQuery(eighties))
  const stops = [pool, page].map((observer) => observer.subscribe(() => {}))
  for (let step = 0; step < 40; step++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(100)
  }
  stops.forEach((stop) => stop())
  assert.deepEqual(
    sent.map(({ query }) => query),
    [QUERIES.decadeWithPool, QUERIES.decadeWithPool],
    `sent ${sent.length} requests over two tries`,
  )
  assert.deepEqual(client.getQueryData(eraQuery(eighties).queryKey), [{ id: 5, tags: [] }])
  assert.deepEqual(client.getQueryData(poolQuery(eighties).queryKey), {
    titles: [],
    count: 0,
    hasNextPage: false,
  })
})

// The plan's section 2 lets the pool ask only once the decade's page has its titles, so the page
// can't wait for the pool to ask: a pool said to be wanted before the page asks (a decade picked
// with a slider set) goes with the page's request, and takes its half when it asks, then or a few
// ms into the page's request, still one request in all (the plan's REC-3).
for (const when of ['once the page is in', 'a few ms into the page’s request'] as const)
  test(`a decade picked with its pool wanted is 1 request, the pool asking ${when}`, async (t) => {
    const sent = answering(t)
    const client = new QueryClient()
    t.after(() => client.clear())
    const [eighties] = decades('1980s')
    wantPool(client, eighties)
    const pool = new QueryObserver(client, { ...poolQuery(eighties), enabled: false })
    const page = new QueryObserver(client, eraQuery(eighties))
    const stops = [pool, page].map((observer) => observer.subscribe(() => {}))
    t.after(() => stops.forEach((stop) => stop()))
    if (when === 'once the page is in') await settled(page)
    else await new Promise((resolve) => setTimeout(resolve, 2))
    pool.setOptions(poolQuery(eighties))
    await settled(pool, page)
    assert.deepEqual(
      sent.map(({ query }) => query),
      [QUERIES.decadeWithPool],
      'not one request for the page and its pool',
    )
    assert.deepEqual(client.getQueryData(eraQuery(eighties).queryKey), [{ id: 5, tags: [] }])
    assert.deepEqual(client.getQueryData(poolQuery(eighties).queryKey), {
      titles: [],
      count: 0,
      hasNextPage: false,
    })
  })

// Back on a decade whose page is cached but out of date (over 6 hours), with a slider set: the page
// asks again as it is drawn, and its pool is wanted. Whichever the page subscribes first, the two
// go in one request.
for (const first of ['pool', 'page'] as const)
  test(`a decade's out-of-date page and its wanted pool, the ${first} first, are 1 request`, async (t) => {
    const sent = answering(t)
    const client = new QueryClient()
    t.after(() => client.clear())
    const [eighties] = decades('1980s')
    client.setQueryData(eraQuery(eighties).queryKey, [complete], {
      updatedAt: Date.now() - 7 * 60 * 60 * 1000,
    })
    wantPool(client, eighties)
    const page = new QueryObserver(client, eraQuery(eighties))
    const pool = new QueryObserver(client, poolQuery(eighties))
    const stops = (first === 'pool' ? [pool, page] : [page, pool]).map((observer) =>
      observer.subscribe(() => {}),
    )
    t.after(() => stops.forEach((stop) => stop()))
    await settled(pool, page)
    assert.deepEqual(
      sent.map(({ query }) => query),
      [QUERIES.decadeWithPool],
    )
    assert.deepEqual(client.getQueryData(eraQuery(eighties).queryKey), [{ id: 5, tags: [] }])
  })

// A pool asking alone waits for the mood scoring before it asks AniList, so a scoring file that
// fails to load (offline, or an old tab after a deploy renamed it) costs none of the 30 requests a
// minute a class on one Wi-Fi shares: asked for on its own, or with its decade's page cached.
test('a pool asking alone whose scoring fails to load sends AniList nothing', async (t) => {
  const sent = answering(t)
  const { current } = moodScoring
  moodScoring.current = undefined
  t.after(() => (moodScoring.current = current))
  t.mock.method(moodScoring, 'load', () =>
    Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
  )
  const [eighties] = decades('1980s')
  for (const pageCached of [false, true]) {
    const client = new QueryClient()
    t.after(() => client.clear())
    if (pageCached) client.setQueryData(eraQuery(eighties).queryKey, [complete])
    await assert.rejects(client.fetchQuery(poolQuery(eighties)), TypeError)
    assert.deepEqual(sent, [], `a request went out${pageCached ? ', the page cached' : ''}`)
  }
})

// The pool keeps its half of a request it went in until the mood scoring has loaded, so a scoring
// file that fails once (a flaky connection) costs no second request when the pool tries again.
test('a pool whose scoring fails to load once takes its half of the request again, sending nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent = answering(t)
  const { current, load } = moodScoring
  moodScoring.current = undefined
  t.after(() => (moodScoring.current = current))
  let loads = 0
  t.mock.method(moodScoring, 'load', () =>
    ++loads === 1
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
      : load(),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })
  t.after(() => client.clear())
  const [eighties] = decades('1980s')
  wantPool(client, eighties)
  const page = new QueryObserver(client, eraQuery(eighties))
  const pool = new QueryObserver(client, poolQuery(eighties))
  const stops = [page, pool].map((observer) => observer.subscribe(() => {}))
  for (let step = 0; step < 40; step++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(100)
  }
  stops.forEach((stop) => stop())
  assert.equal(loads, 2, 'the scoring wasn’t tried twice')
  assert.deepEqual(
    sent.map(({ query }) => query),
    [QUERIES.decadeWithPool],
    'the retry sent a request of its own',
  )
  assert.deepEqual(client.getQueryData(poolQuery(eighties).queryKey), {
    titles: [],
    count: 0,
    hasNextPage: false,
  })
})

// That half is kept only while the pool would still be fresh from it: TanStack dates the pool from
// when it is cut, not from when AniList sent it. So a pool whose scoring failed, tried again 7
// hours later (Try again on the matches), asks AniList for itself, not an old answer counted fresh.
test('a pool tried again over 6 hours after its scoring failed asks alone, taking no old half', async (t) => {
  const start = Date.UTC(2000, 0, 3)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start })
  const sent = answering(t)
  const { current, load } = moodScoring
  moodScoring.current = undefined
  t.after(() => (moodScoring.current = current))
  let loads = 0
  t.mock.method(moodScoring, 'load', () =>
    ++loads === 1
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
      : load(),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  t.after(() => client.clear())
  const [eighties] = decades('1980s')
  wantPool(client, eighties)
  const page = new QueryObserver(client, eraQuery(eighties))
  const pool = new QueryObserver(client, poolQuery(eighties))
  const stops = [page, pool].map((observer) => observer.subscribe(() => {}))
  t.after(() => stops.forEach((stop) => stop()))
  const steps = async () => {
    for (let step = 0; step < 40; step++) {
      await new Promise((resolve) => setImmediate(resolve))
      t.mock.timers.tick(100)
    }
  }
  await steps()
  assert.equal(pool.getCurrentResult().status, 'error', 'the pool didn’t fail with its scoring')
  t.mock.timers.setTime(start + 7 * 60 * 60 * 1000)
  void pool.refetch()
  await steps()
  assert.equal(loads, 2, 'the scoring wasn’t tried twice')
  assert.deepEqual(
    sent.map(({ query }) =>
      query === QUERIES.pool ? 'pool' : query === QUERIES.decadeWithPool ? 'both' : query,
    ),
    ['both', 'pool'],
    'the pool took its half of a request sent 7 hours before',
  )
  assert.equal(pool.getCurrentResult().status, 'success')
})

// Tried again sooner, within those 6 hours, the pool takes the half, and is dated from when its
// request was sent, not from when it was cut: it stays fresh only for what is left of the 6 hours.
test('a pool that takes a half kept 5 hours is dated from when its request was sent', async (t) => {
  const start = Date.UTC(2000, 0, 3)
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: start })
  const sent = answering(t)
  const { current, load } = moodScoring
  moodScoring.current = undefined
  t.after(() => (moodScoring.current = current))
  let loads = 0
  t.mock.method(moodScoring, 'load', () =>
    ++loads === 1
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
      : load(),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  t.after(() => client.clear())
  const [eighties] = decades('1980s')
  wantPool(client, eighties)
  const page = new QueryObserver(client, eraQuery(eighties))
  const pool = new QueryObserver(client, poolQuery(eighties))
  const stops = [page, pool].map((observer) => observer.subscribe(() => {}))
  t.after(() => stops.forEach((stop) => stop()))
  const steps = async () => {
    for (let step = 0; step < 40; step++) {
      await new Promise((resolve) => setImmediate(resolve))
      t.mock.timers.tick(100)
    }
  }
  await steps()
  assert.equal(pool.getCurrentResult().status, 'error', 'the pool didn’t fail with its scoring')
  t.mock.timers.setTime(start + 5 * 60 * 60 * 1000)
  void pool.refetch()
  await steps()
  const { dataUpdatedAt } = client.getQueryState(poolQuery(eighties).queryKey)!
  assert.deepEqual(
    {
      sent: sent.map(({ query }) => (query === QUERIES.decadeWithPool ? 'both' : query)),
      status: pool.getCurrentResult().status,
      dated: `${(dataUpdatedAt - start) / 1000} s after the request went`,
    },
    { sent: ['both'], status: 'success', dated: '0 s after the request went' },
  )
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
    // A list for the lists, a title for the title on its own, two pages for a pool.
    const page = { pageInfo: { hasNextPage: false }, media: [] }
    return new Response(
      JSON.stringify({ data: { Page: { media: [] }, Media: { id: 1 }, p1: page, p2: page } }),
    )
  })
  for (const options of [
    trendingQuery(),
    ...ERAS.map((era) => eraQuery(era)),
    searchQuery('frieren'),
    titleQuery(154587),
    listQuery([154587, 1]),
    ...ERAS.map((era) => poolQuery(era)),
  ]) {
    // The cast stands in for the context TanStack Query passes; only the signal is used.
    await options.queryFn!({ signal: new AbortController().signal } as never)
  }
  assert.equal(sent.length, 2 * ERAS.length + 4)
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
