// join and leave: a socket in a room gets the room's new messages as they are saved. Anyone may
// join, signed in or not (D12), since anyone may read the chat.
import { roomPayloadSchema, type ErrorCode } from '@anibeam/shared'
import type { FastifyBaseLogger } from 'fastify'
import { acked } from './acked.ts'
import type { ChatSocket } from './sockets.ts'

/** The most rooms one socket may be in at once (D12), its own room left out. */
export const MAX_ROOMS = 5

/** Listens for join and leave on `socket`. */
export function roomEvents(socket: ChatSocket, log: FastifyBaseLogger) {
  // { roomKey }: {ok: true} once the socket is in the room, so that a client can fetch the room's
  // history next and miss nothing sent after it. Joining a room the socket is in already is ok.
  socket.on(
    'join',
    acked(log, async (payload) => {
      const parsed = roomPayloadSchema.safeParse(payload)
      if (!parsed.success) return { error: 'invalid' satisfies ErrorCode }
      const { roomKey } = parsed.data
      // Socket.IO puts each socket in a room of its own id, which isn't one of these.
      if (!socket.rooms.has(roomKey) && socket.rooms.size - 1 >= MAX_ROOMS)
        return { error: 'too-many-rooms' satisfies ErrorCode }
      await socket.join(roomKey)
      return { ok: true }
    }),
  )
  // { roomKey }: {ok: true} once the socket is out of the room, or was never in it.
  socket.on(
    'leave',
    acked(log, async (payload) => {
      const parsed = roomPayloadSchema.safeParse(payload)
      if (!parsed.success) return { error: 'invalid' satisfies ErrorCode }
      await socket.leave(parsed.data.roomKey)
      return { ok: true }
    }),
  )
}
