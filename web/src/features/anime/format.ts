// How a title's AniList fields read on screen.
import type { Media } from './queries.ts'

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
  MUSIC: 'Music video',
}

/** The English title when AniList has one, otherwise the romaji. */
export const titleOf = (media: Media) => media.title.english ?? media.title.romaji

/** "Fall 2023", "2023" or "Year unknown". */
export const seasonOf = (media: Media) =>
  [media.season ? SEASONS[media.season] : null, media.seasonYear].filter(Boolean).join(' ') ||
  'Year unknown'

export const formatOf = (media: Media) =>
  media.format ? (FORMATS[media.format] ?? media.format) : null

export const studioOf = (media: Media) => media.studios.nodes[0]?.name ?? null

/** "Ep 9 in 2d 4h", or null when nothing is scheduled or it has aired since the data was cached. */
export function nextEpisode(media: Media, now = Date.now()) {
  const next = media.nextAiringEpisode
  if (!next) return null
  const seconds = next.airingAt - now / 1000
  if (seconds <= 0) return null
  const hours = Math.max(1, Math.round(seconds / 3600))
  const wait = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`
  return `Ep ${next.episode} in ${wait}`
}

/**
 * Some titles only have a small cover (230px wide): AniList then points "extraLarge" at the
 * medium-size folder. The intro leaves these out of its cover fan, where they'd look blurry.
 */
export const hasSmallCover = (media: Media) =>
  /\/cover\/(medium|small)\//.test(media.coverImage.extraLarge)
