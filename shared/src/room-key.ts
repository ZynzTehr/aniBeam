// A chat room's key (spec section 7): an AniList media id with an episode number, for one episode
// of a series, or with "all", for a movie, an OVA or a special, and for a series' general room.
// The server stores only this; titles and art come from AniList on the client.
import * as z from 'zod/mini'

/**
 * A room key, such as anime:154587:ep:5 or anime:1:all, written one way only: lower case, and
 * numbers from 1 with no leading zero, so that one room never has two keys.
 */
export const roomKeySchema = z
  .string()
  .check(z.regex(/^anime:[1-9]\d{0,9}:(?:ep:[1-9]\d{0,4}|all)$/))

export type RoomKey = z.infer<typeof roomKeySchema>
