// PROTOTYPE ONLY (Phase 2 design comparison). Not production code: the chosen
// direction is rebuilt properly in Phase 3.
import { queryOptions } from '@tanstack/react-query'
import { SAFE } from '../features/anime/queries.ts'
import { anilist } from '../lib/anilist.ts'

export type Show = {
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
  nextAiringEpisode: { episode: number; timeUntilAiring: number } | null
}

const FIELDS = `id title { romaji english native } coverImage { extraLarge large color } bannerImage genres
  averageScore format episodes season seasonYear studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode timeUntilAiring }`

const TRENDING = `query { Page(perPage: 24) { media(type: ANIME, sort: TRENDING_DESC, countryOfOrigin: "JP", ${SAFE}) { ${FIELDS} } } }`
const NINETIES = `query { Page(perPage: 16) { media(type: ANIME, sort: POPULARITY_DESC, countryOfOrigin: "JP", startDate_greater: 19899999, startDate_lesser: 20000000, status_not: NOT_YET_RELEASED, ${SAFE}) { ${FIELDS} } } }`

const list = (query: string) =>
  queryOptions({
    queryKey: ['prototype', query],
    queryFn: ({ signal }) =>
      anilist<{ Page: { media: Show[] } }>(query, {}, signal).then((data) => data.Page.media),
    staleTime: 6 * 60 * 60 * 1000,
  })

export const trendingShows = () => list(TRENDING)
export const ninetiesShows = () => list(NINETIES)

export type VariantProps = { shows: Show[]; classics: Show[] }

export const titleOf = (show: Show) => show.title.english ?? show.title.romaji

/**
 * Some titles only have a small cover (230px wide): AniList then points "extraLarge" at the
 * medium-size folder. The intro leaves these out of its cover fan, where they'd look blurry.
 */
export const hasSmallCover = (show: Show) =>
  /\/cover\/(medium|small)\//.test(show.coverImage.extraLarge)

const SEASONS: Record<string, string> = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}
const FORMATS: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  OVA: 'OVA',
  ONA: 'ONA',
  SPECIAL: 'Special',
}

export const seasonOf = (show: Show) =>
  [show.season ? SEASONS[show.season] : null, show.seasonYear].filter(Boolean).join(' ') ||
  'Year unknown'
export const formatOf = (show: Show) => (show.format ? (FORMATS[show.format] ?? show.format) : null)
export const studioOf = (show: Show) => show.studios.nodes[0]?.name ?? null

/** "Ep 9 in 2d 4h", or null when nothing is scheduled. */
export function nextEpisode(show: Show) {
  const next = show.nextAiringEpisode
  if (!next) return null
  const hours = Math.max(1, Math.round(next.timeUntilAiring / 3600))
  const wait = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`
  return `Ep ${next.episode} in ${wait}`
}

/**
 * A rough contrast clamp for the prototypes only: keeps hue and pushes lightness
 * into a readable band for a dark or light page. The real, tested deriveAccent
 * comes after a direction is chosen.
 */
export function accent(hex: string | null, page: 'dark' | 'light' | 'vivid', fallback = '#ff3d7f') {
  const value = /^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex! : fallback
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  const hue = Math.round((h * 60 + 360) % 360)
  // Decorative fills ('vivid') sit inside black outlines, so they can stay bright.
  const sat = Math.round(Math.max(s, page === 'vivid' ? 0.8 : 0.5) * 100)
  const band = { dark: [0.6, 0.74], light: [0.3, 0.42], vivid: [0.5, 0.6] }[page]
  const light = Math.min(Math.max(l, band[0]), band[1])
  return `hsl(${hue} ${sat}% ${Math.round(light * 100)}%)`
}

/** Genres for the prototype mood chips. */
export const MOODS = {
  any: { label: 'Any vibe', genres: [] as string[] },
  cozy: { label: 'Cozy', genres: ['Slice of Life', 'Comedy'] },
  hype: { label: 'Hype', genres: ['Action', 'Sports', 'Mecha'] },
  cerebral: { label: 'Mind-bending', genres: ['Mystery', 'Psychological', 'Sci-Fi'] },
  tears: { label: 'Tearjerker', genres: ['Drama', 'Romance'] },
}
export type Mood = keyof typeof MOODS
