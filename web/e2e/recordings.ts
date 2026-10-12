// What the browser checks ask AniList for, and where AniList's answers to it are kept: anilist/,
// one JSON file per request, written by scripts/record-anilist.ts (`npm run e2e:record` in web/).
// A recorded browser (see Browser.open) answers the page from them, so it sends AniList nothing.
// Each recording holds the request it answers, built by the app's own code in queries.ts, so one
// made for an older query no longer matches what the page asks for, and recordings.test.ts names
// it. The answers are AniList's (anilist.co): only what the checks ask for, with no images and no
// user data, used by the checks alone and never shipped with the app.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import {
  ERAS,
  eraQuery,
  FIRST_ERA,
  searchQuery,
  trendingQuery,
} from '../src/features/anime/queries.ts'
import type { Recording } from './browser.ts'

export const FOLDER = fileURLToPath(new URL('./anilist/', import.meta.url))

/**
 * What the checks type into the search box for AniList to answer, in the order discover.e2e.ts
 * types them. Not here: the searches a check answers inside the page (answerSearches), and
 * 'bad request', which every check that sends it answers itself, with a rewrite.
 */
export const SEARCHES = [
  'frieren',
  'zzqqxxnotananime',
  'mushishi',
  'mushi',
  'mushishi zoku',
  '進撃の巨人',
  '進撃の巨人 final',
  'naruto',
  'dragon ball',
  'dragon',
  'nar',
  'zzqqxx',
  'zzqqxxy',
  'a very long search that keeps going and going past the width of the bubble and the screen '.repeat(
    2,
  ),
  'The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life',
  // Sent when its check runs on its own. In a whole run, that check clears the box before the
  // search goes out.
  'one piece',
]

/** The decades the checks ask for on their own: the 1980s, picked, and the 1990s, refreshed. */
export const DECADES = ['1980s', '1990s']

type Request = Recording['request']

// What the stand-in for fetch answers: no titles, for whichever lists were asked for.
const NO_TITLES = { data: { Page: { media: [] }, trending: { media: [] }, era: { media: [] } } }

/**
 * The one request the app sends AniList while `ask` runs, caught on its way out by a stand-in for
 * fetch, so nothing is sent. `ask` gets a query client of its own.
 */
async function sent(ask: (client: QueryClient) => Promise<unknown>): Promise<Request> {
  const bodies: string[] = []
  const fetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body))
    return Response.json(NO_TITLES)
  }
  const client = new QueryClient()
  try {
    await ask(client)
  } finally {
    globalThis.fetch = fetch
    client.clear()
  }
  if (bodies.length !== 1)
    throw new Error(`The app sent AniList ${bodies.length} requests, where one was expected.`)
  return JSON.parse(bodies[0])
}

/**
 * A search's recording's name: its words, if they are plain and short. Otherwise, the start of
 * them in plain letters and digits, and a few characters of a hash, so no two searches share one.
 */
function searchName(search: string) {
  if (/^[a-z0-9]+( [a-z0-9]+)*$/.test(search) && search.length <= 40)
    return `search-${search.replaceAll(' ', '-')}`
  const words = search
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '')
  const hash = createHash('sha256').update(search).digest('hex').slice(0, 8)
  return ['search', words, hash].filter(Boolean).join('-')
}

/**
 * Every request the browser checks send AniList, by its recording's name, each built by the app's
 * own code with a stand-in for fetch. Only the recorder and recordings.test.ts call this, as it
 * swaps the global fetch: browser.ts reads the recordings on its own.
 */
export async function requests(): Promise<{ name: string; request: Request }[]> {
  const wanted = [
    {
      name: 'first-visit',
      // Trending and the first decade in the cache with no titles yet, as App has them when the
      // first of the two asks: it then asks for both in one request (see bothLists in queries.ts).
      request: await sent((client) => {
        for (const options of [trendingQuery(), eraQuery(FIRST_ERA)])
          new QueryObserver(client, options)
        return client.fetchQuery(trendingQuery())
      }),
    },
    { name: 'trending', request: await sent((client) => client.fetchQuery(trendingQuery())) },
  ]
  for (const id of DECADES) {
    const era = ERAS.find((era) => era.id === id)
    if (!era) throw new Error(`DECADES lists ${id}, which isn't in ERAS.`)
    wanted.push({
      name: `era-${id}`,
      request: await sent((client) => client.fetchQuery(eraQuery(era))),
    })
  }
  for (const term of SEARCHES) {
    const request = await sent((client) => client.fetchQuery(searchQuery(term)))
    wanted.push({ name: searchName(String(request.variables.search)), request })
  }
  const names = wanted.map(({ name }) => name)
  const twice = names.filter((name, i) => names.indexOf(name) !== i)
  if (twice.length) throw new Error(`SEARCHES or DECADES asks for one request twice: ${twice}`)
  return wanted
}

/** The recordings in anilist/, by name: the file's, without .json. */
export function recordings(): Map<string, Recording> {
  if (!existsSync(FOLDER)) return new Map()
  return new Map(
    readdirSync(FOLDER)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [
        file.slice(0, -'.json'.length),
        JSON.parse(readFileSync(join(FOLDER, file), 'utf8')),
      ]),
  )
}

/**
 * How the recordings stand against the requests the checks send, by name: the requests with no
 * recording (missing); those whose recording isn't a whole one, or was made for another request,
 * such as an older version of its query, which the page no longer sends (stale); and the
 * recordings no check asks for any more (unused).
 */
export function compare(
  wanted: { name: string; request: Request }[],
  saved: Map<string, Recording>,
) {
  const answers = (recording: Recording | undefined, request: Request) =>
    Number.isInteger(recording?.status) &&
    recording?.body !== undefined &&
    isDeepStrictEqual(recording?.request, request)
  return {
    missing: wanted.filter(({ name }) => !saved.has(name)).map(({ name }) => name),
    stale: wanted
      .filter(({ name, request }) => saved.has(name) && !answers(saved.get(name), request))
      .map(({ name }) => name),
    unused: [...saved.keys()].filter((name) => !wanted.some((w) => w.name === name)),
  }
}
