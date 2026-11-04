// What a client sends to post a message (spec section 7): message:send's payload.
import * as z from 'zod/mini'
import { roomKeySchema } from './room-key.ts'

/**
 * A character that shows. trim() takes spaces off, but not the characters that show nothing
 * either: a zero-width space, a direction mark, a control character, the Hangul fillers or
 * the Braille blank. A body of those alone would post a blank line, so a body needs one other.
 */
const VISIBLE = /[^\p{Default_Ignorable_Code_Point}\p{Cc}\p{Z}\u2800]/u

/**
 * A message's body: trimmed, then 1 to 500 code points, counted as [...body].length is and as
 * the database's char_length counts them, so 500 single emoji fit. A body of spaces alone is
 * empty once trimmed, and one of characters that show nothing is refused (VISIBLE). A NUL, or half of a surrogate pair on its own, is refused too: Postgres
 * can't store the first, and would store the second as another character than the one sent.
 */
const bodySchema = z.string().check(
  z.trim(),
  z.refine((body) => {
    const length = [...body].length
    return length >= 1 && length <= 500 && !/[\0\p{Cs}]/u.test(body) && VISIBLE.test(body)
  }),
)

/**
 * message:send's payload: { roomKey, body, spoiler }, with no other key. Who sends it, and so
 * the handle, comes from the socket's sign-in, never from the payload.
 */
export const messageSendSchema = z.strictObject({
  roomKey: roomKeySchema,
  body: bodySchema,
  spoiler: z.boolean(),
})

export type MessageSend = z.infer<typeof messageSendSchema>
