// A title's trailer (spec §3A): played in the card's own dialog, from YouTube alone, and only once
// the visitor presses "Watch trailer" (spec §5: YouTube loads only when a trailer is played).
import { reducedMotion } from '../../lib/motion.ts'
import type { Media } from './queries.ts'

// A YouTube video id: 11 of A-Z, a-z, 0-9, - and _. Nothing else may reach the addresses made from
// it, as an id from a saved copy someone edited could try: a ? or # would add to the address, a /
// or .. would leave the video's path.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The YouTube video id of the title's trailer, or null when it has none the card can play: none at
 * all, one on another site (AniList also knows Dailymotion), or an id that isn't one. AniList
 * sends some ids with a space after them (LHtdKWJdif4 with a tab), which it trims.
 */
export function trailerOf(media: Media): string | null {
  const { id, site } = media.trailer ?? {}
  if (typeof id !== 'string' || typeof site !== 'string' || site.trim() !== 'youtube') return null
  const trimmed = id.trim()
  return VIDEO_ID.test(trimmed) ? trimmed : null
}

/**
 * Where the trailer's dialog plays the trailer from, by the id trailerOf gave: YouTube's privacy-
 * enhanced address (spec §3A), which keeps its cookies off the visitor's browser until the video
 * plays. rel=0 has the videos YouTube suggests at its end come from the trailer's own channel;
 * playsinline=1 has an iPhone play it in the dialog, not full screen; and autoplay=1, as the
 * visitor pressed "Watch trailer" to see it, but not with reduced motion asked for (spec §3J), on
 * the device or the site: then the visitor presses play.
 */
export const embedOf = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${reducedMotion() ? '' : '&autoplay=1'}`

/** The trailer's own page on YouTube, for "Open on YouTube": an id trailerOf gave. */
export const watchOf = (id: string) => `https://www.youtube.com/watch?v=${id}`
