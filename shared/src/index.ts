// Types and validation schemas shared by web/ and server/. The schemas use zod/mini, whose
// functions a bundle takes one by one, so web/ pays only for the ones it uses.
export { roomKeySchema, type RoomKey } from './room-key.ts'

/** An AniList media ID. */
export type AnimeId = number
