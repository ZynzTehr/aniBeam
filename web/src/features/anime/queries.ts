import { hashKey, queryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { anilist, AniListError, isRateLimited, type Variables } from '../../lib/anilist.ts'
import { tagsOf, type TagFlags } from './tags.ts'

/** One of AniList's tags on a title, with what the card needs to place it (see tags.ts). */
export type Tag = TagFlags & { name: string }

/** The fields the panels, title card and pull need. AniList leaves many of them null. */
export type Media = {
  id: number
  title: { romaji: string; english: string | null; native: string | null }
  coverImage: { extraLarge: string; large: string; color: string | null }
  bannerImage: string | null
  genres: string[]
  averageScore: number | null
  format: string | null
  episodes: number | null
  season: string | null
  seasonYear: number | null
  studios: { nodes: { name: string }[] }
  /** airingAt is a Unix time in seconds, so a cached result never shows a stale countdown. */
  nextAiringEpisode: { episode: number; airingAt: number } | null
  /** AniList's synopsis as text with a few tags of its own markup (see synopsis.ts). */
  description: string | null
  /** Minutes an episode runs. */
  duration: number | null
  /** Only those the card shows (see cardOf): the top few, and the top few spoilers. */
  tags: Tag[]
  /**
   * Where its trailer is: a site's video id. Carried with the lists, like its details, so a card
   * knows at once whether to offer "Watch trailer"; nothing from the site loads before that press
   * (no thumbnail is asked for).
   */
  trailer: { id: string | null; site: string | null } | null
}

/**
 * One title asked for on its own (see titleQuery): Media's fields, and how far it has aired, which
 * a list's copy of a title, opened from the list, doesn't have.
 */
export type Title = Media & { status?: string | null }

// Every media query must keep SAFE, which keeps adult titles out (the gacha
// shows random picks to anyone). queries.test.ts fails if any media(...) call in
// the source drops it. SAFE only works on top-level media(...) calls: titles
// reached through relations or recommendations (Phase 3) can't take it, so those
// must request isAdult and drop flagged titles in code.
export const SAFE = 'isAdult: false, genre_not_in: ["Hentai"]'
const CARD = `id title { romaji english native } coverImage { extraLarge large color } bannerImage
  genres averageScore format episodes season seasonYear studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt } description(asHtml: false) duration
  tags { name rank isAdult isGeneralSpoiler isMediaSpoiler } trailer { id site }`

/**
 * A title as the cache keeps it: its tags cut to those the card shows, the top 8 and the top 8
 * spoilers, of the 28 a popular title has on average (75 for One Piece). The lists carry each
 * title's details, so that opening one costs no request (AniList allows 30 a minute per IP, and a
 * class on one Wi-Fi shares them), and the cut keeps the saved copy about a third smaller.
 */
export const cardOf = <T extends Media>(media: T): T => {
  const { shown, spoilers } = tagsOf(media.tags)
  return { ...media, tags: [...shown, ...spoilers] }
}

// A page of each list. The queries below are built from them, so the request for both of a first
// visit's lists asks for exactly what the two on their own do.
const TRENDING = `Page(perPage: 20) { media(type: ANIME, sort: TRENDING_DESC, countryOfOrigin: "JP", ${SAFE}) { ${CARD} } }`
const ERA_VARIABLES =
  '$from: FuzzyDateInt, $to: FuzzyDateInt, $status: MediaStatus, $notStatus: MediaStatus'
const ERA = `Page(perPage: 20) { media(type: ANIME, sort: POPULARITY_DESC, countryOfOrigin: "JP", startDate_greater: $from, startDate_lesser: $to, status: $status, status_not: $notStatus, ${SAFE}) { ${CARD} } }`

export const QUERIES = {
  trending: `query { ${TRENDING} }`,
  era: `query (${ERA_VARIABLES}) { ${ERA} }`,
  search: `query ($search: String) { Page(perPage: 20) { media(type: ANIME, sort: SEARCH_MATCH, search: $search, ${SAFE}) { ${CARD} } } }`,
  // A first visit's trending and first decade in one request, each list under its own name
  // (see bothLists).
  firstVisit: `query (${ERA_VARIABLES}) { trending: ${TRENDING} era: ${ERA} }`,
  // The titles bundled for when AniList can't be reached, by id (see scripts/refresh-samples.ts).
  // Only finished titles, so none has an episode countdown that would go stale in the bundle.
  // One title by its AniList id, for a card opened at its address (/anime/:id). AniList answers 404
  // for an id it has no anime for, and for an adult title, which SAFE keeps out.
  title: `query ($id: Int) { Media(id: $id, type: ANIME, ${SAFE}) { ${CARD} status } }`,
  samples: `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, status: FINISHED, type: ANIME, ${SAFE}) { ${CARD} } } }`,
  // The titles on the visitor's list (spec §3F), by id, at most 50, a page of AniList's: the
  // samples' query without their FINISHED filter, as the list holds airing titles too (see
  // listQuery). AniList gives them in an order of its own.
  list: `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME, ${SAFE}) { ${CARD} } } }`,
}

export type Era = { id: string; label: string; variables: Variables }

// AniList dates are FuzzyDateInt numbers (YYYYMMDD; a year-only date is YYYY0000)
// and both bounds are exclusive, so the 1980s are "after 1979-99-99, before 1990-00-00".
// Unreleased titles belong to Upcoming only, even when they already have a date.
const decade = (year: number): Era => ({
  id: `${year}s`,
  label: `${year}s`,
  variables: { from: year * 10000 - 1, to: (year + 10) * 10000, notStatus: 'NOT_YET_RELEASED' },
})

export const ERAS: Era[] = [
  {
    id: 'pre-1970',
    label: 'Pre-1970',
    variables: { from: 10000000, to: 19700000, notStatus: 'NOT_YET_RELEASED' },
  },
  ...[1970, 1980, 1990, 2000, 2010, 2020].map(decade),
  { id: 'upcoming', label: 'Upcoming', variables: { status: 'NOT_YET_RELEASED' } },
]

/** The decade the page opens on. A first visit asks for it in one request with trending. */
export const FIRST_ERA = ERAS.find((era) => era.id === '1990s')!

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

type Page = { media: Media[] }

// Spec §2: a screen's lists come in one request, because AniList allows 30 requests a minute
// per IP address and a class on one Wi-Fi shares one. A first visit (nothing saved) needs
// trending and the first decade at the same moment, so while neither has titles yet, each asks
// for both in one request: whichever asks first sends it, and the other joins it while it runs.
// Retries fail and come back together, so they share one request a try too.
let bothRunning: Promise<{ trending: Page; era: Page }> | undefined
const bothLists = () =>
  (bothRunning ??= anilist<{ trending: Page; era: Page }>(
    QUERIES.firstVisit,
    FIRST_ERA.variables,
  ).finally(() => (bothRunning = undefined)))

/**
 * True when trending and the first decade are both in the cache with no titles yet. A queryFn
 * called on its own, outside TanStack (as some tests do), has no client and never pairs. The
 * return type is written out because TypeScript can't infer it: the options read here take
 * their type from mediaQuery, which calls this.
 */
const firstVisit = (client?: QueryClient): boolean =>
  [trendingQuery(), eraQuery(FIRST_ERA)].every(({ queryKey }) => {
    const state = client?.getQueryState(queryKey)
    return state !== undefined && state.data === undefined
  })

// The cache key is the exact request (query text and variables), so editing a query
// or an era's dates never shows results saved under the old version.
//
// TanStack cancels a query the user moves away from only if its queryFn read the
// abort signal. The signal is read only while requests are held for a rate limit:
// then a stale request is dropped before it is sent. Otherwise a request AniList
// has already counted finishes and its result is cached for later. The request for both of a
// first visit's lists reads no signal: trending is always on screen, so it is always wanted.
//
// `part` names the list's place in that request, for the lists that can be in it. Whether they
// go together is decided as the request is made, from what the cache holds then, not when the
// options are built: TanStack can start a fetch with an earlier render's options.
const mediaQuery = (
  query: string,
  variables: Variables,
  staleTime: number,
  part?: 'trending' | 'era',
) =>
  queryOptions({
    queryKey: ['anilist', query, variables],
    queryFn: (context) =>
      part && firstVisit(context.client)
        ? bothLists().then((lists) => lists[part].media.map(cardOf))
        : anilist<{ Page: Page }>(
            query,
            variables,
            isRateLimited() ? context.signal : undefined,
          ).then((data) => data.Page.media.map(cardOf)),
    staleTime,
  })

export const trendingQuery = () => mediaQuery(QUERIES.trending, {}, 30 * MINUTE, 'trending')

export const eraQuery = (era: Era) =>
  mediaQuery(QUERIES.era, era.variables, 6 * HOUR, era === FIRST_ERA ? 'era' : undefined)

// AniList search ignores capitals and extra spaces, so "Frieren " and "frieren"
// share one request and one cache entry.
const searchTerm = (term: string) => term.trim().replace(/\s+/g, ' ').toLowerCase()

export const searchQuery = (term: string) =>
  mediaQuery(QUERIES.search, { search: searchTerm(term) }, 6 * HOUR)

/**
 * The titles on the visitor's list, by their ids, in one request (spec §3F): at most 50, AniList's
 * page, which the caller picks. The ids are sorted in the key, as numbers, so the same titles saved
 * in another order share one request and one saved answer. Fresh for 6 hours, as airing titles
 * are, and kept 30 days (see keptFor), so My List still shows offline (spec §3H).
 */
export const listQuery = (ids: number[]) => {
  const options = mediaQuery(QUERIES.list, { ids: ids.toSorted((a, b) => a - b) }, 6 * HOUR)
  return queryOptions({
    ...options,
    // Each change to the list makes a new key, and each answer, up to 50 whole titles, would stay
    // its 30 days in the saved copy, pushing useful answers out of it once storage is full. So an
    // answer for the list takes the place of the earlier ones no page is showing.
    queryFn: async (context) => {
      const titles = await options.queryFn!(context)
      const hash = hashKey(context.queryKey)
      context.client?.removeQueries({
        queryKey: ['anilist', QUERIES.list],
        predicate: (query) => query.queryHash !== hash && !query.getObserversCount(),
      })
      return titles
    },
  })
}

/**
 * One title, by its AniList id: a number, as each title's id in the lists is, so a card opened from
 * a list and one opened at its address share the key. TanStack's default staleTime (0) would ask
 * AniList again at each opening: a finished title's details don't change, so they stay fresh for
 * 30 days, and an airing title's (its next episode) for 6 hours. The saved cache keeps them as long
 * (see keptFor), so a finished title opened again at its address within the month asks for nothing.
 */
export const titleQuery = (id: number) =>
  queryOptions({
    queryKey: ['anilist', QUERIES.title, { id }],
    queryFn: (context) =>
      anilist<{ Media: Title }>(
        QUERIES.title,
        { id },
        isRateLimited() ? context.signal : undefined,
      ).then((data) => {
        // AniList answers 404 with an error for an id with no anime (anilist() throws it); an
        // answer with no title and no error says the same, so it reads the same.
        if (!data.Media) throw new AniListError('Not Found.', 404)
        return cardOf(data.Media)
      }),
    staleTime: (query) => (query.state.data?.status === 'FINISHED' ? 30 * DAY : 6 * HOUR),
    // A title AniList said it hasn't got isn't asked for again by itself, back on the tab or on a
    // return to its address, as a query with no answer otherwise would be (Try again doesn't offer
    // itself for it either): it would spend a request on the same answer.
    refetchOnWindowFocus: (query) => !isMissing(query.state.error),
    retryOnMount: false,
  })

/**
 * How long the saved cache keeps an answer, from when it came (see lib/queryClient.ts): a title
 * AniList says is finished, 30 days, as its details won't change, and My List's titles 30 days, so
 * the list still shows offline (spec §3H) a month after its last visit; anything else a day, a
 * list or a title still airing (its next episode changes), so a visitor back after a week never
 * sees that week's lists. Not how long an answer stays fresh (staleTime): a trending list out of
 * date after 30 minutes still shows while the page asks for a newer one.
 */
export const keptFor = (queryKey: QueryKey, data: unknown) =>
  queryKey[1] === QUERIES.list ||
  (queryKey[1] === QUERIES.title && (data as Title | undefined)?.status === 'FINISHED')
    ? 30 * DAY
    : DAY

const isMissing = (error: unknown) => error instanceof AniListError && error.status === 404

/** True when `now` refines the search `before` (letters added or removed), not a new search. */
export const isRefinement = (before: string, now: string) => {
  const [a, b] = [searchTerm(before), searchTerm(now)]
  return a !== '' && (b.startsWith(a) || a.startsWith(b))
}
