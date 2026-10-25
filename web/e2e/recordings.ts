// What the browser checks ask AniList for, and where AniList's answers to it are kept: anilist/,
// one JSON file per request, written by scripts/record-anilist.ts (`npm run e2e:record` in web/).
// A recorded browser (see Browser.open) answers the page from them, so it sends AniList nothing.
// Each recording holds the request it answers, built by the app's own code in queries.ts, so one
// made for an older query no longer matches what the page asks for, and recordings.test.ts names
// it. It also names a recording that lacks what a check relies on AniList's titles for, such as
// Frieren first in a search for "frieren" (see problems()). The answers are AniList's
// (anilist.co): only what the checks ask for, with no images and no user data, used by the checks
// alone and never shipped with the app.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { hasSmallCover, titleOf } from '../src/features/anime/format.ts'
import {
  ERAS,
  eraQuery,
  FIRST_ERA,
  listQuery,
  poolQuery,
  searchQuery,
  titleQuery,
  trendingQuery,
  wantPool,
  type Era,
  type Media,
} from '../src/features/anime/queries.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { pullable } from '../src/features/mood/roll.ts'
import { AniListError } from '../src/lib/anilist.ts'
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
  'one piece',
]

/** The decades the checks ask for on their own: the 1980s, picked, and the 1990s, refreshed. */
export const DECADES = ['1980s', '1990s']

/**
 * The decades whose mood pool the checks ask for on its own, two pages of 50 in one request
 * (poolQuery): the 1990s, which a slider's first touch asks for on a first visit (the plan's
 * REC-2), and the smallest, Pre-1970 and Upcoming, for the "few" line and whether a page 3 is
 * worth asking for (REC-3b, REC-3c).
 */
export const POOLS = ['1990s', 'pre-1970', 'upcoming']

/**
 * The decades the checks pick with a slider set and nothing cached for them, so the page asks for
 * the decade's page and its mood pool in one request (decadeWithPool; see wantPool in queries.ts):
 * the 1980s (REC-3).
 */
export const DECADES_WITH_POOLS = ['1980s']

/**
 * The titles the checks open at their address (/anime/:id), so the page asks for each on its own:
 * Frieren. Not here: an id AniList has no anime for, which the checks answer with a rewrite.
 */
export const TITLES = [154587]

/**
 * The lists of saved ids the checks open My List with, each by its recording's name, so the page
 * asks AniList for their titles in one request (listQuery). Not here: a list a check answers with
 * a built answer, with a rewrite.
 */
export const LISTS: Record<string, number[]> = {
  // Twelve titles already in the recordings, as listQuery sends them, sorted: Cowboy Bebop, ONE
  // PIECE (airing), Evangelion, AKIRA, Mononoke-hime, serial experiments lain, PERFECT BLUE,
  // Totoro, Nausicaä, Black Clover, Frieren and Kusuriya no Hitorigoto 3rd Season (airing). A cold
  // /list with these saved sends exactly this one request (the plan's done-when 2).
  'list-12': [1, 21, 30, 47, 164, 339, 437, 523, 572, 97940, 154587, 195516],
}

type Request = Recording['request']

// What the stand-in for fetch answers: no titles, for whichever lists, or title, were asked for,
// and a mood pool's two pages with none and no page after them.
const NO_POOL_TITLES = { pageInfo: { hasNextPage: false }, media: [] }
const NO_TITLES = {
  data: {
    Page: { media: [] },
    trending: { media: [] },
    era: { media: [] },
    Media: null,
    p1: NO_POOL_TITLES,
    p2: NO_POOL_TITLES,
  },
}

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
    // What the answer becomes doesn't matter, only the request: a title asked for on its own fails
    // as not found on the stand-in's empty answer. Anything else failing is a fault of its own.
    await ask(client).catch((error: unknown) => {
      if (!(error instanceof AniListError && error.status === 404)) throw error
    })
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

/** The era an id in DECADES, POOLS or DECADES_WITH_POOLS names. */
function eraOf(id: string): Era {
  const era = ERAS.find((era) => era.id === id)
  if (!era) throw new Error(`${id} isn't in ERAS.`)
  return era
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
  for (const id of DECADES)
    wanted.push({
      name: `era-${id}`,
      request: await sent((client) => client.fetchQuery(eraQuery(eraOf(id)))),
    })
  for (const id of POOLS)
    wanted.push({
      name: `pool-${id}`,
      request: await sent((client) => client.fetchQuery(poolQuery(eraOf(id)))),
    })
  for (const id of DECADES_WITH_POOLS)
    wanted.push({
      name: `era-pool-${id}`,
      // The decade's pool wanted, as a slider set makes it, and then both asking for theirs, as
      // the page does once the decade is picked: the page takes the pool with it, one request.
      request: await sent((client) => {
        const era = eraOf(id)
        wantPool(client, era)
        return Promise.all([client.fetchQuery(eraQuery(era)), client.fetchQuery(poolQuery(era))])
      }),
    })
  for (const term of SEARCHES) {
    const request = await sent((client) => client.fetchQuery(searchQuery(term)))
    wanted.push({ name: searchName(String(request.variables.search)), request })
  }
  for (const id of TITLES)
    wanted.push({
      name: `title-${id}`,
      request: await sent((client) => client.fetchQuery(titleQuery(id))),
    })
  for (const [name, ids] of Object.entries(LISTS))
    wanted.push({ name, request: await sent((client) => client.fetchQuery(listQuery(ids))) })
  const names = wanted.map(({ name }) => name)
  const twice = names.filter((name, i) => names.indexOf(name) !== i)
  if (twice.length)
    throw new Error(
      `SEARCHES, DECADES, POOLS, DECADES_WITH_POOLS, TITLES or LISTS asks for one request twice: ${twice}`,
    )
  return wanted
}

/**
 * The recordings in anilist/, or in the folder given (the recorder's, when a test hands it one), by
 * name: the file's, without .json.
 */
export function recordings(folder = FOLDER): Map<string, Recording> {
  if (!existsSync(folder)) return new Map()
  return new Map(
    readdirSync(folder)
      .filter((file) => file.endsWith('.json'))
      .map((file) => [
        file.slice(0, -'.json'.length),
        JSON.parse(readFileSync(join(folder, file), 'utf8')),
      ]),
  )
}

/** Whether a file holds a whole recording: a status and an answer, whatever they say. */
const whole = (recording: Recording | undefined) =>
  Number.isInteger(recording?.status) && recording?.body !== undefined

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
    whole(recording) && isDeepStrictEqual(recording?.request, request)
  return {
    missing: wanted.filter(({ name }) => !saved.has(name)).map(({ name }) => name),
    stale: wanted
      .filter(({ name, request }) => saved.has(name) && !answers(saved.get(name), request))
      .map(({ name }) => name),
    unused: [...saved.keys()].filter((name) => !wanted.some((w) => w.name === name)),
  }
}

// A title asked for on its own comes as data.Media, the title itself, not a list.
const isTitle = (name: string, value: any) => name === 'Media' && Number.isInteger(value?.id)

/**
 * Why an answer can't be kept as a recording, or '' when it can: it must be a 200 with no errors
 * and a list of titles for each list asked for, empty for a search that matches nothing, or the
 * title asked for.
 */
function unusable({ status, body }: Recording): string {
  if (status !== 200 || body?.errors)
    return `AniList answered ${status}${body?.errors ? ` with errors: ${JSON.stringify(body.errors)}` : ''}`
  const lists = Object.entries(body?.data ?? {})
  if (
    !lists.length ||
    lists.some(([name, list]: [string, any]) => !Array.isArray(list?.media) && !isTitle(name, list))
  )
    return `AniList answered ${status} with no list of titles`
  return ''
}

/**
 * The lists of titles in an answer, by name: data.Page, or a first visit's trending and era; a
 * title asked for on its own as a list of one, data.Media.
 */
export const listsOf = ({ body }: Recording): Record<string, Media[]> =>
  Object.fromEntries(
    Object.entries(body?.data ?? {}).map(([name, list]: [string, any]) => [
      name,
      isTitle(name, list) ? [list] : Array.isArray(list?.media) ? list.media : [],
    ]),
  )

/**
 * A mood pool's two pages, by their names in an answer (see QUERIES.pool and decadeWithPool): their
 * titles carry their relations, which no list's copy of a title has.
 */
export const POOL_PAGES = ['p1', 'p2']

/** A list of titles in the recordings: a recording's name, and the list's in its answer. */
type List = [recording: string, list: string]

// Trending and the 1990s come alone and in a first visit's one request (see bothLists in
// queries.ts), and the page shows whichever it got last: a first visit's lists, then a list alone
// once a refresh of it lands (discover.e2e.ts's Try again check refreshes trending, and the checks
// after it see those titles). So both must hold what the checks need of the list.
const TRENDING: List[] = [
  ['first-visit', 'trending'],
  ['trending', 'Page'],
]
const NINETIES: List[] = [
  ['first-visit', 'era'],
  ['era-1990s', 'Page'],
]
const search = (term: string): List => [searchName(term), 'Page']

/** A list as a message names it: its recording, and its name in the answer if it has two. */
const named = ([name, list]: List) => (list === 'Page' ? name : `${name}'s ${list}`)
const bigCovers = (titles: Media[]) => titles.filter((media) => !hasSmallCover(media)).length

/**
 * What the browser checks rely on AniList's titles for, beyond an answer that has some: each rule,
 * the lists it applies to, which checks rely on it and how, and how a list breaks it ('' when it
 * doesn't). The checks read the titles as the page shows them (titleOf). A check run on titles
 * that break a rule fails, or worse, passes without testing what it says: the Naruto check, say,
 * counting frieren's titles, still on screen, as naruto's.
 */
const RULES: {
  lists: List[]
  needs: string
  why: string
  broken: (titles: Media[], listOf: (list: List) => Media[] | undefined) => string
}[] = [
  {
    lists: TRENDING,
    needs: 'at least 9 titles',
    why: "for the nine panels that titlesShown() in browser.ts waits for and discover.e2e.ts's 'renders the header, intro, nine trending panels, the pull and the decades' counts",
    broken: (titles) => (titles.length < 9 ? `it has ${titles.length}` : ''),
  },
  {
    lists: TRENDING,
    needs: "a title that isn't Ecchi",
    why: "so the pull, which never hands out an Ecchi one, has a title to hand out whatever decade is open: discover.e2e.ts's 'later features show as coming soon and cannot be used' reads the hint it shows then, and 'the lever pulls a real title from the page' pulls one",
    broken: (titles) => (pullable(titles).length ? '' : 'none is'),
  },
  {
    lists: TRENDING,
    needs: 'at least 4 big covers',
    why: "for the intro's fan, which shows the first 3 (see coverFan): outage.e2e.ts's 'on a phone, intro covers that can’t load keep their place in their title’s color' waits for all 3, and refresh.e2e.ts's 'new covers for the intro wait while it is on screen, and show once it is scrolled away' reverses the list, whose fan has a new cover only if there is a 4th",
    broken: (titles) => (bigCovers(titles) < 4 ? `it has ${bigCovers(titles)}` : ''),
  },
  {
    lists: TRENDING,
    needs: "a first nine unlike the samples' first nine",
    why: "as outage.e2e.ts's 'once AniList answers, every section shows its own titles again' tells AniList's titles from the samples by them",
    broken: (titles) =>
      isDeepStrictEqual(titles.slice(0, 9).map(titleOf), SAMPLES.slice(0, 9).map(titleOf))
        ? "its first nine are the samples'"
        : '',
  },
  {
    lists: NINETIES,
    needs: 'at least 15 titles',
    why: "for discover.e2e.ts's 'tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring' (on a desktop and a small phone) and 'on a phone, tabbing along the decade strip, both ways, keeps each focused panel in view, with its whole ring', which tab through 15 panels each way",
    broken: (titles) => (titles.length < 15 ? `it has ${titles.length}` : ''),
  },
  {
    lists: NINETIES,
    needs: 'big covers on its first 2 titles',
    why: "as discover.e2e.ts's 'on a 2x screen, decade covers load AniList’s 460px file where there is one' waits for the first 2 covers to load, then needs 2 loaded covers that offer the bigger file",
    broken: (titles) => {
      const big = bigCovers(titles.slice(0, 2))
      return big < 2 ? `it has ${big}` : ''
    },
  },
  {
    lists: [['era-1980s', 'Page']],
    needs: 'at least 15 titles',
    why: "so its row scrolls well past the 6 panels a desktop shows, as discover.e2e.ts's 'with motion allowed, a newly picked decade stays at Ch.1 while its titles pop in' and 'picking another decade opens it at Ch.1, wherever the last one was scrolled' scroll it to its end",
    broken: (titles) => (titles.length < 15 ? `it has ${titles.length}` : ''),
  },
  {
    lists: [['era-1980s', 'Page']],
    needs: "a first title other than the 1990s' first",
    why: "as discover.e2e.ts's 'picking the 1980s chip swaps the strip to 1980s titles', 'with motion allowed, a newly picked decade stays at Ch.1 while its titles pop in' and 'picking another decade opens it at Ch.1, wherever the last one was scrolled' wait for the strip's first title to change",
    broken: (titles, listOf) => {
      const opening = titles[0] && titleOf(titles[0])
      const same = NINETIES.find((list) => {
        const first = listOf(list)?.[0]
        return first && titleOf(first) === opening
      })
      return same ? `it opens on '${opening}', as ${named(same)} does` : ''
    },
  },
  {
    lists: [search('frieren')],
    needs: 'a first title naming Frieren',
    why: "as discover.e2e.ts's 'searching shows results in place of the intro, and Esc returns focus to the opened result' opens its first result as Frieren",
    broken: (titles) =>
      !titles.length
        ? 'it has none'
        : /frieren/i.test(titleOf(titles[0]))
          ? ''
          : `it opens on '${titleOf(titles[0])}'`,
  },
  {
    lists: [search('frieren')],
    needs: 'fewer than 12 titles',
    why: "so discover.e2e.ts's 'a different search shows that it is loading, even when typed from far down the results', which runs just after a search for frieren is cleared, can't count frieren's titles, still on screen, as the 12 naruto results it waits for",
    broken: (titles) => (titles.length >= 12 ? `it has ${titles.length}` : ''),
  },
  {
    lists: [search('mushishi')],
    needs: 'a title naming MUSHI-SHI',
    why: "as discover.e2e.ts's 'a different search, typed over the last or after clearing it, never shows the old titles while it loads', 'refining a search keeps its titles on screen, and the visitor’s place, while it loads' and 'a refinement typed from below the results brings them back into view' wait for one",
    broken: (titles) =>
      titles.some((media) => /mushi-?shi/i.test(titleOf(media))) ? '' : 'none does',
  },
  {
    lists: [search('naruto')],
    needs: 'at least 12 titles',
    why: "for discover.e2e.ts's 'a different search shows that it is loading, even when typed from far down the results', which waits for 12",
    broken: (titles) => (titles.length < 12 ? `it has ${titles.length}` : ''),
  },
  {
    lists: [search('naruto')],
    needs: 'a title naming Naruto',
    why: "as discover.e2e.ts's 'titles that have left the screen stay gone, even for a search they would refine' waits for one",
    broken: (titles) => (titles.some((media) => /naruto/i.test(titleOf(media))) ? '' : 'none does'),
  },
  {
    lists: [search('zzqqxxnotananime')],
    needs: 'no titles',
    why: "as discover.e2e.ts's 'a search with no matches says so, and clearing it brings the intro back' waits for 'No titles found.'",
    broken: (titles) => (titles.length ? `it has ${titles.length}` : ''),
  },
  {
    lists: [search('zzqqxx'), search('zzqqxxy')],
    needs: 'no titles',
    why: "as discover.e2e.ts's 'screen readers hear each search’s outcome from one status line that is always there' waits to hear that none were found for zzqqxx, then for zzqqxxy",
    broken: (titles) => (titles.length ? `it has ${titles.length}` : ''),
  },
  {
    lists: [['title-154587', 'Media']],
    needs: 'a title naming Frieren',
    why: "as addresses.e2e.ts's checks open /anime/154587, then wait for a card naming Frieren, as 'a visit to a title’s address opens its card over the page, with or without a last slash, and again on a refresh' does",
    broken: (titles) =>
      !titles.length
        ? 'it has none'
        : /frieren/i.test(titleOf(titles[0]))
          ? ''
          : `it is '${titleOf(titles[0])}'`,
  },
  {
    lists: [['list-12', 'Page']],
    needs: 'a title for each of its 12 ids',
    why: 'as list.e2e.ts saves those 12 ids and waits for a cover for each, from the one request a cold /list sends',
    broken: (titles) => {
      const lacking = LISTS['list-12'].filter((id) => !titles.some((media) => media.id === id))
      return lacking.length ? `it lacks ${lacking.join(', ')}` : ''
    },
  },
  {
    lists: [search('one piece')],
    needs: 'a title',
    why: "as discover.e2e.ts's 'search results show in a grid without sideways overflow', on a phone, waits for one",
    broken: (titles) => (titles.length ? '' : 'it has none'),
  },
]

/**
 * The recordings the rules judge. A rule for a recording no check asks for, such as a search
 * renamed since, would judge nothing and never fail, so recordings.test.ts checks this list.
 */
export const JUDGED = [...new Set(RULES.flatMap(({ lists }) => lists.map(([name]) => name)))]

/**
 * What the recordings lack that the browser checks rely on, a line for each: a recording that
 * isn't a 200 with titles, and each rule a list breaks (see RULES). A missing recording, or one
 * that isn't whole, is compare()'s to name. The recorder writes nothing while this finds any.
 */
export function problems(saved: Map<string, Recording>): string[] {
  const found: string[] = []
  // The lists of titles in each recording that has them. One that isn't a 200 with titles is
  // named once, here, and not again by every rule its titles would break.
  const usable = new Map<string, Record<string, Media[]>>()
  for (const [name, recording] of saved) {
    if (!whole(recording)) continue
    const why = unusable(recording)
    if (why)
      found.push(
        `${name} needs to be a 200 with no errors and a list of titles for each list asked for (or the title asked for), as the checks expect AniList's titles, not the samples or Try again; ${why}.`,
      )
    else usable.set(name, listsOf(recording))
  }
  // A list in a recording that has titles, as none if its answer lacks that list.
  const listOf = ([name, list]: List) => usable.get(name) && (usable.get(name)![list] ?? [])
  for (const rule of RULES)
    for (const list of rule.lists) {
      const titles = listOf(list)
      const broken = titles && rule.broken(titles, listOf)
      if (broken) found.push(`${named(list)} needs ${rule.needs}, ${rule.why}; ${broken}.`)
    }
  return found
}
