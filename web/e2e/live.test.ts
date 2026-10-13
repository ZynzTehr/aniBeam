import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QUERIES } from '../src/features/anime/queries.ts'
import {
  answerProblems,
  askedAgain,
  emptyLists,
  limitProblems,
  listsAsked,
  verdict,
  type Seen,
} from './live.ts'
import { recordings } from './recordings.ts'

// The live checks judge what AniList does with the app's requests by live.ts alone, so its
// judgement is tried here, offline: AniList's recorded answers must pass, and answers broken as an
// API change would break them, data short of what a check needs, a first visit's list sent empty,
// and AniList's outages must each be told for what they are.

const saved = recordings()
/** A recording, as a fresh copy, so a test can break it where it is. */
function recorded(name: string) {
  const recording = saved.get(name)
  if (!recording) throw new Error(`web/e2e/anilist/ has no ${name}.json`)
  return structuredClone(recording)
}
/** What answerProblems() finds in a recording once `change` has broken its data. */
function brokenAnswer(name: string, change: (data: any) => void, wanted?: any) {
  const answer = recorded(name)
  change(answer.body.data)
  return answerProblems(answer, wanted)
}
/** The title a search for "frieren" finds first: Frieren (see problems() in recordings.ts). */
const frieren = () => recorded('search-frieren').body.data.Page.media[0]

const DATA = "That's AniList's data, not its API"

// first-visit is AniList's answer to the very request a live check of a first visit sends.
test('AniList’s recorded answer to a first visit passes, as a live check would judge it', () => {
  const answer = recorded('first-visit')
  assert.equal(
    verdict('first-visit', { post: answer, page: { status: 200, remaining: '29' } }),
    null,
  )
  assert.deepEqual(answerProblems(answer), [])
  assert.deepEqual(limitProblems({ remaining: '29' }), [])
})

// The browser checks take the recordings for AniList's answers, so they must be in the formats the
// app reads, as AniList's live answers must be: one that isn't, such as one edited by hand, would
// have the checks try the app on answers AniList doesn't give.
test('every recording is in the formats the app reads AniList’s answers in', () => {
  assert.ok(saved.size > 0, 'web/e2e/anilist/ holds no recordings')
  assert.deepEqual(
    [...saved].flatMap(([name, recording]) =>
      answerProblems(recording).map((problem) => `${name}: ${problem}`),
    ),
    [],
    'record them again with `npm run e2e:record -- <names>` in web/; if that brings the same, AniList’s API has changed, and the app has to change with it',
  )
})

// A field the app asks for with no format to be held to would let a title in any form pass. Each
// field the first visit's query asks for is set to true, which no format allows, in a title that
// holds them all (a next episode and a studio too), and must be named, or the object or list it
// is in.
test('every field the app asks AniList for is held to a format', () => {
  const answer = recorded('first-visit')
  const i = answer.body.data.trending.media.findIndex(
    (media: any) => media.nextAiringEpisode && media.studios.nodes.length,
  )
  assert.ok(i >= 0, 'no trending title has a next episode and a studio')
  const fields = [...new Set([...listsAsked(QUERIES.firstVisit).values()].flat())]
  assert.ok(fields.length > 0, 'no field read from the first visit’s query')
  for (const field of fields) {
    const broken = structuredClone(answer)
    const keys = field.split('.')
    const parent = keys
      .slice(0, -1)
      .reduce(
        (at, key) => (Array.isArray(at[key]) ? at[key][0] : at[key]),
        broken.body.data.trending.media[i],
      )
    parent[keys.at(-1)!] = true
    const named = keys.map(
      (_, n) => `data.trending.media[${i}].${keys.slice(0, n + 1).join('.')} is `,
    )
    assert.ok(
      answerProblems(broken).some((problem) => named.some((start) => problem.startsWith(start))),
      `${field} set to true went unnoticed`,
    )
  }
})

// AniList's answer to a first visit or a search, changed as a change to its API would change it,
// so that the app can't read it as it does: [what changed, the problems found, words one holds].
const unreadable: [string, () => string[], string][] = [
  [
    'a cover comes back null',
    () =>
      brokenAnswer('first-visit', (data) => (data.trending.media[0].coverImage.extraLarge = null)),
    'data.trending.media[0].coverImage.extraLarge is null',
  ],
  [
    'a cover over http, not https',
    () =>
      brokenAnswer('first-visit', (data) => {
        const cover = data.trending.media[1].coverImage
        cover.large = cover.large.replace('https:', 'http:')
      }),
    'data.trending.media[1].coverImage.large is "http://',
  ],
  [
    'a colour not in #rrggbb form',
    () =>
      brokenAnswer('first-visit', (data) => (data.era.media[1].coverImage.color = 'rgb(1, 2, 3)')),
    'data.era.media[1].coverImage.color is "rgb(1, 2, 3)"',
  ],
  [
    'airingAt in milliseconds',
    () =>
      brokenAnswer('first-visit', (data) => {
        const media = data.trending.media.find((media: any) => media.nextAiringEpisode)
        media.nextAiringEpisode.airingAt *= 1000
      }),
    '.nextAiringEpisode is {"episode":',
  ],
  [
    'a score with decimals',
    () => brokenAnswer('first-visit', (data) => (data.era.media[3].averageScore = 7.5)),
    'data.era.media[3].averageScore is 7.5',
  ],
  [
    'a new season name',
    () => brokenAnswer('first-visit', (data) => (data.era.media[0].season = 'AUTUMN')),
    'data.era.media[0].season is "AUTUMN"',
  ],
  [
    'a format in lower case',
    () => brokenAnswer('first-visit', (data) => (data.trending.media[5].format = 'tv')),
    'data.trending.media[5].format is "tv"',
  ],
  [
    'an adult title past the filter',
    () => brokenAnswer('first-visit', (data) => data.trending.media[2].genres.push('Hentai')),
    'data.trending.media[2] is in the Hentai genre',
  ],
  [
    'a title twice in a list',
    () => brokenAnswer('first-visit', (data) => (data.era.media[1] = data.era.media[0])),
    'data.era.media lists id',
  ],
  [
    'a field the app doesn’t ask for',
    () => brokenAnswer('first-visit', (data) => (data.trending.media[4].isAdult = false)),
    "data.trending.media[4] has isAdult, which the app doesn't ask for",
  ],
  [
    'a field the app asks for gone',
    () => brokenAnswer('first-visit', (data) => delete data.trending.media[4].studios),
    'data.trending.media[4] has no studios.nodes.name, which the app asks for',
  ],
  [
    'a list gone',
    () => brokenAnswer('first-visit', (data) => delete data.era),
    'data.era.media is missing, where the app needs a list of titles',
  ],
  [
    'no 1990s title from the 1990s: the decade filter gone',
    () =>
      brokenAnswer('first-visit', (data) =>
        data.era.media.forEach((media: any) => (media.seasonYear = 2014)),
      ),
    'from 1989 to 2000, the decade asked for: AniList no longer applies',
  ],
  [
    'a search’s title in another format',
    () => brokenAnswer('search-frieren', (data) => (data.Page.media[0].averageScore = 7.5)),
    'data.Page.media[0].averageScore is 7.5',
  ],
]
for (const [name, problems, words] of unreadable)
  test(`an answer the app can’t read as it does fails, naming what in it: ${name}`, () => {
    const found = problems()
    assert.ok(
      found.some((problem) => problem.includes(words)),
      `not caught; found: ${JSON.stringify(found)}`,
    )
    assert.ok(
      found.every((problem) => !problem.includes(DATA)),
      `blamed on AniList’s data: ${JSON.stringify(found)}`,
    )
  })

// What the live checks need of AniList's data that the app doesn't: a check that fails for want
// of it must say that it is AniList's data, not its API, as the app is fine.
const shortfalls: [string, () => string[], string][] = [
  [
    'eight trending titles, one fewer than the page’s panels',
    () => brokenAnswer('first-visit', (data) => (data.trending.media.length = 8)),
    'data.trending.media has 8 titles, fewer than the 9',
  ],
  [
    'three titles for the 1990s',
    () => brokenAnswer('first-visit', (data) => (data.era.media.length = 3)),
    'data.era.media has 3 titles, fewer than the 4',
  ],
  [
    'a 1990s title from 2014',
    () => brokenAnswer('first-visit', (data) => (data.era.media[5].seasonYear = 2014)),
    'from outside 1989 to 2000, the decade asked for',
  ],
  [
    'a title its own romaji no longer finds',
    () => brokenAnswer('search-frieren', (data) => data.Page.media.shift(), frieren()),
    `but not ${frieren().title.romaji} (id ${frieren().id}), by its own romaji`,
  ],
]
for (const [name, problems, words] of shortfalls)
  test(`AniList’s data short of what a live check needs fails, saying it’s AniList’s data: ${name}`, () => {
    const found = problems()
    const problem = found.find((problem) => problem.includes(words))
    assert.ok(problem, `not caught; found: ${JSON.stringify(found)}`)
    assert.ok(problem.includes(DATA), `not said to be AniList’s data: ${problem}`)
  })

// AniList always has a first visit's trending and 1990s titles, but while busy it has sent a list
// of them empty. So a list sent empty is not AniList's data: the check asks once more, from a fresh
// first visit, and goes on if the second answer has its titles, or skips if one comes empty again.
// A list with titles, but fewer than the page shows, is still AniList's data, failed at once.

/** AniList's answer to a first visit, with the `lists` named (trending, era) sent empty. */
function emptied(...lists: string[]) {
  const answer = recorded('first-visit')
  for (const name of lists) answer.body.data[name].media = []
  return answer
}

test('a first visit’s list that AniList sends empty is asked for again, not failed as its data', () => {
  assert.deepEqual(emptyLists(recorded('first-visit')), [], 'a full answer is asked for again')
  assert.deepEqual(
    emptyLists(emptied('trending')),
    ['trending'],
    'trending sent empty is not asked for again',
  )
  assert.deepEqual(
    emptyLists(emptied('era')),
    ['era'],
    'the 1990s sent empty are not asked for again',
  )
  assert.deepEqual(
    emptyLists(emptied('trending', 'era')),
    ['trending', 'era'],
    'trending and the 1990s sent empty are not both asked for again',
  )
  // A list gone, or no data at all, is AniList's API changed, not a list sent empty: asked for
  // again, it would skip as AniList busy where it must fail (see 'a list gone' above).
  const gone = recorded('first-visit')
  delete gone.body.data.era
  assert.deepEqual(emptyLists(gone), [], 'a list gone is asked for again')
  assert.deepEqual(emptyLists({ body: { data: null } }), [], 'no data is asked for again')
})

test('a first visit’s list sent empty, then full when asked again, passes, saying the first was empty', () => {
  const second = recorded('first-visit')
  const said = askedAgain(emptyLists(emptied('trending')), emptyLists(second))
  assert.ok('note' in said, `not passed: ${JSON.stringify(said)}`)
  assert.match(
    said.note,
    /^AniList's first answer had no titles in data\.trending\.media; asked again 20 seconds later, from a fresh first visit, it sent them$/,
  )
  assert.deepEqual(answerProblems(second), [])
})

// [what, the lists empty in the first answer, and in the second, the words].
const emptyTwice: [string, string[], string[], string][] = [
  [
    'trending sent empty twice',
    ['trending'],
    ['trending'],
    'with no titles in data.trending.media, a list it always fills',
  ],
  [
    'the 1990s sent empty twice',
    ['era'],
    ['era'],
    'with no titles in data.era.media, a list it always fills',
  ],
  [
    'trending sent empty, then the 1990s',
    ['trending'],
    ['era'],
    'with no titles in data.trending.media or data.era.media, lists it always fills',
  ],
]
for (const [name, first, again, words] of emptyTwice)
  test(`AniList down or busy skips, saying it’s not the app: ${name}, 20 seconds apart`, () => {
    const said = askedAgain(first, again)
    assert.ok('skip' in said, `not skipped: ${JSON.stringify(said)}`)
    assert.match(
      said.skip,
      /^AniList answered the app's first-visit request twice, 20 seconds apart/,
    )
    assert.ok(said.skip.includes(words), `not in its words: ${said.skip}`)
    assert.match(said.skip, /It's not the app/)
  })

test('a first visit’s list with titles, but too few, is not asked for again: it fails as AniList’s data', () => {
  for (const [name, length] of [
    ['trending', 8],
    ['trending', 1],
    ['era', 3],
  ] as const) {
    const answer = recorded('first-visit')
    answer.body.data[name].media.length = length
    assert.deepEqual(emptyLists(answer), [], `${name} cut to ${length} titles is asked for again`)
    const found = answerProblems(answer)
    assert.ok(
      found.some(
        (problem) =>
          problem.startsWith(`data.${name}.media has ${length} titles, fewer than`) &&
          problem.includes(DATA),
      ),
      `${name} cut to ${length} titles not failed as AniList’s data: ${JSON.stringify(found)}`,
    )
  }
})

test('a search that finds the title whose romaji it searched for passes', () => {
  assert.deepEqual(answerProblems(recorded('search-frieren'), frieren()), [])
})

// What an answer must hold comes from the app's own query, not from the request it answers: so
// an answer to anything else, such as a recording made for an older query, can't pass on rules
// of its own making. Here the request and its titles both have a field the app doesn't ask for.
test('an answer to a request the app doesn’t send is not judged as if it were', () => {
  const answer = recorded('first-visit')
  answer.request.query = answer.request.query.replaceAll('bannerImage', 'bannerImage isAdult')
  for (const list of Object.values(answer.body.data) as any[])
    for (const media of list.media) media.isAdult = false
  assert.deepEqual(answerProblems(answer), [
    "the request isn't one of the app's queries in queries.ts, so nothing says what its answer should hold",
  ])
})

const PAGE_ERROR = { error: 'TypeError: Failed to fetch' }

// AniList's real answer, on 2026-10-12, to the app's search query with bannerImage and isAdult
// renamed, as if AniList had renamed them: a 400 in its own words.
const RENAMED = {
  errors: [
    {
      message:
        'Unknown argument "isAdultX" on field "media" of type "Page". Did you mean "isAdult"?',
      status: 400,
    },
    {
      message:
        'Cannot query field "bannerImageX" on type "Media". Did you mean "bannerImage" or "coverImage"?',
      status: 400,
    },
  ],
  data: null,
}

// AniList answering, but in a way the app can't use: [what, what the check saw, the words].
const unusable: [string, Seen, RegExp][] = [
  [
    'a field AniList no longer has, turned down in its own words',
    { post: { status: 400, body: RENAMED }, page: { status: 400, remaining: '28' } },
    /turned the app's first-visit request down \(HTTP 400: Unknown argument "isAdultX".*; Cannot query field "bannerImageX" on type "Media"/,
  ],
  [
    'a 200 with errors',
    {
      post: { status: 200, body: { data: null, errors: [{ message: 'Validation error' }] } },
      page: { status: 200, remaining: '29' },
    },
    /turned the app's first-visit request down \(HTTP 200: Validation error\)/,
  ],
  [
    'CORS headers gone: a 200 over the network, a TypeError in the page',
    {
      post: { status: 200, body: recorded('first-visit').body },
      failure: 'MissingAllowOriginHeader',
      page: PAGE_ERROR,
    },
    /\(HTTP 200\), but the browser kept its answer from the page \(MissingAllowOriginHeader\): AniList's CORS headers/,
  ],
  [
    'a preflight that no longer allows the app’s Content-Type',
    {
      preflight: { status: 204 },
      failure: 'HeaderDisallowedByPreflightResponse',
      page: PAGE_ERROR,
    },
    /CORS preflight \(HTTP 204\) no longer lets the page send the app's first-visit request \(HeaderDisallowedByPreflightResponse\)/,
  ],
  [
    'a 5xx while the health query is answered',
    {
      post: { status: 500, body: { errors: [{ message: 'Internal Server Error' }] } },
      page: { status: 500, remaining: '29' },
      health: 200,
    },
    /answers a one-line health query \(HTTP 200\), but answered the app's first-visit request with HTTP 500: Internal Server Error/,
  ],
  [
    'a 5xx while the health query is turned down, so AniList is up',
    { post: { status: 502 }, page: PAGE_ERROR, health: 404 },
    /health query \(HTTP 404\), but answered the app's first-visit request with HTTP 502/,
  ],
]
for (const [name, seen, words] of unusable)
  test(`AniList answering in a way the app can’t use fails, in its words: ${name}`, () => {
    const said = verdict('first-visit', seen)
    assert.ok(said && 'fail' in said, `not failed: ${JSON.stringify(said)}`)
    assert.match(said.fail, words)
  })

// AniList down, busy or out of reach, which says nothing about the app: [what, seen, the words].
const outages: [string, Seen, RegExp][] = [
  [
    'a 429 in AniList’s own words',
    {
      post: { status: 429, body: { errors: [{ message: 'Too Many Requests.', status: 429 }] } },
      page: { status: 429, remaining: '0' },
    },
    /AniList is busy: it turned the app's first-visit request away \(HTTP 429: Too Many Requests\.\)/,
  ],
  [
    'a 429 from the burst limiter, without CORS headers',
    { post: { status: 429 }, failure: 'MissingAllowOriginHeader', page: PAGE_ERROR },
    /AniList is busy: .*\(HTTP 429\)/,
  ],
  [
    'a Cloudflare 503 without CORS headers, and one to the health query',
    { post: { status: 503 }, failure: 'MissingAllowOriginHeader', page: PAGE_ERROR, health: 503 },
    /isn't responding right now \(HTTP 503, and HTTP 503 to a one-line health query\)/,
  ],
  [
    'a 502, and no answer to the health query',
    { post: { status: 502 }, page: { status: 502, remaining: null }, health: 0 },
    /isn't responding right now \(HTTP 502, and no answer to a one-line health query\)/,
  ],
  [
    'a preflight answered 503, so the request never went out',
    {
      preflight: { status: 503 },
      failure: 'PreflightInvalidStatus',
      page: PAGE_ERROR,
      health: 503,
    },
    /\(HTTP 503 to its CORS preflight, and HTTP 503 to a one-line health query\)/,
  ],
  [
    'no connection',
    { failure: 'net::ERR_NAME_NOT_RESOLVED', page: PAGE_ERROR },
    /can't be reached from this machine \(net::ERR_NAME_NOT_RESOLVED\)/,
  ],
  [
    'the connection lost after the preflight',
    { preflight: { status: 204 }, failure: 'net::ERR_CONNECTION_RESET', page: PAGE_ERROR },
    /can't be reached from this machine \(net::ERR_CONNECTION_RESET\)/,
  ],
  [
    'no answer within 20 seconds',
    {},
    /didn't answer the app's first-visit request within 20 seconds/,
  ],
  [
    'no answer within 20 seconds, after the preflight',
    { preflight: { status: 204 } },
    /didn't answer the app's first-visit request within 20 seconds/,
  ],
  [
    'the API switched off (HTTP 403)',
    {
      post: { status: 403, body: { errors: [{ message: 'The API is temporarily disabled.' }] } },
      page: { status: 403, remaining: null },
    },
    /refused requests from this machine \(HTTP 403: The API is temporarily disabled\.\)/,
  ],
]
for (const [name, seen, words] of outages)
  test(`AniList down or busy skips, saying it’s not the app: ${name}`, () => {
    const said = verdict('first-visit', seen)
    assert.ok(said && 'skip' in said, `not skipped: ${JSON.stringify(said)}`)
    assert.match(said.skip, words)
    assert.match(said.skip, /[Ii]t's not the app/)
  })

// A 5xx alone can't tell AniList being down from the app's query tripping it up.
test('a 5xx is judged only once the one-line health query has had its answer', () => {
  assert.deepEqual(
    verdict('first-visit', { post: { status: 500 }, page: { status: 500, remaining: '29' } }),
    { probe: true },
  )
  assert.deepEqual(
    verdict('first-visit', {
      preflight: { status: 503 },
      failure: 'PreflightInvalidStatus',
      page: PAGE_ERROR,
    }),
    { probe: true },
  )
})

// anilist() holds its requests when X-RateLimit-Remaining reads '0', so it must stay readable.
test('X-RateLimit-Remaining that the page can’t read as a whole number fails', () => {
  assert.deepEqual(limitProblems({ remaining: '0' }), [])
  for (const remaining of [null, '', '28.0', ' 28', '-1'])
    assert.match(
      limitProblems({ remaining }).join(),
      /^X-RateLimit-Remaining reads .* in the page, where anilist\(\) needs a whole number/,
      JSON.stringify(remaining),
    )
})
