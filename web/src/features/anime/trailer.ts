// A title's trailer (spec §3A): played in the card's own dialog, from YouTube alone, and only once
// the visitor presses "Watch trailer" (spec §5: YouTube loads only when a trailer is played).
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
