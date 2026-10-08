import { queryOptions } from '@tanstack/react-query'
import { anilist, type Variables } from '../../lib/anilist.ts'

/** The fields a title card needs. AniList leaves many of them null. */
export type Media = {
  id: number
  title: { romaji: string; english: string | null }
  coverImage: { large: string; color: string | null }
  format: string | null
  seasonYear: number | null
  averageScore: number | null
}

// Every media query must keep SAFE, which keeps adult titles out (the gacha
// shows random picks to anyone). queries.test.ts fails if a query drops it.
const SAFE = 'isAdult: false, genre_not_in: ["Hentai"]'
const CARD = 'id title { romaji english } coverImage { large color } format seasonYear averageScore'

export const QUERIES = {
  trending: `query { Page(perPage: 20) { media(type: ANIME, sort: TRENDING_DESC, countryOfOrigin: "JP", ${SAFE}) { ${CARD} } } }`,
  era: `query ($from: FuzzyDateInt, $to: FuzzyDateInt, $status: MediaStatus) { Page(perPage: 20) { media(type: ANIME, sort: POPULARITY_DESC, countryOfOrigin: "JP", startDate_greater: $from, startDate_lesser: $to, status: $status, ${SAFE}) { ${CARD} } } }`,
  search: `query ($search: String) { Page(perPage: 20) { media(type: ANIME, sort: SEARCH_MATCH, search: $search, ${SAFE}) { ${CARD} } } }`,
}

export type Era = { id: string; label: string; variables: Variables }

// AniList dates are FuzzyDateInt numbers (YYYYMMDD; a year-only date is YYYY0000)
// and both bounds are exclusive, so the 1980s are "after 1979-99-99, before 1990-00-00".
const decade = (year: number): Era => ({
  id: `${year}s`,
  label: `${year}s`,
  variables: { from: year * 10000 - 1, to: (year + 10) * 10000 },
})

export const ERAS: Era[] = [
  { id: 'pre-1970', label: 'Pre-1970', variables: { from: 10000000, to: 19700000 } },
  ...[1970, 1980, 1990, 2000, 2010, 2020].map(decade),
  { id: 'upcoming', label: 'Upcoming', variables: { status: 'NOT_YET_RELEASED' } },
]

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// The cache key is the exact request (query text and variables), so editing a query
// or an era's dates never shows results saved under the old version.
const mediaQuery = (query: string, variables: Variables, staleTime: number) =>
  queryOptions({
    queryKey: ['anilist', query, variables],
    queryFn: ({ signal }) =>
      anilist<{ Page: { media: Media[] } }>(query, variables, signal).then(
        (data) => data.Page.media,
      ),
    staleTime,
  })

export const trendingQuery = () => mediaQuery(QUERIES.trending, {}, 30 * MINUTE)

export const eraQuery = (era: Era) => mediaQuery(QUERIES.era, era.variables, 6 * HOUR)

// AniList search ignores capitals and extra spaces, so "Frieren " and "frieren"
// share one request and one cache entry.
export const searchQuery = (term: string) =>
  mediaQuery(QUERIES.search, { search: term.trim().replace(/\s+/g, ' ').toLowerCase() }, 6 * HOUR)
