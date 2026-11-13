// At most 10 connections open at once from one IP address (D12), so that one computer can't
// open thousands and tie the server up. The count is kept on the raw connection, Engine.IO's,
// beneath Socket.IO's sockets (fixed choice 2): up when it opens, down when it closes, whatever
// became of it. A connection refused for a bad token never becomes a socket, and so never
// "disconnects": counted on Socket.IO's own events, each refusal would leave its count behind,
// and a few bad tries would lock an honest user out.
import type { ErrorCode } from '@anibeam/shared'
import type { IncomingMessage } from 'node:http'
import type { ChatServer, ChatSocket } from '../sockets/sockets.ts'

/** The most connections one IP address may have open at once (D12). */
export const MAX_CONNECTIONS_PER_IP = 10

/** A raw connection, beneath a socket. */
type Connection = ChatSocket['conn']

/**
 * Counts `io`'s connections by the IP address each comes from, as `ipOf` reads it from the
 * request that opened it (app.clientIp, client-ip.ts). A socket on a connection opened while
 * its IP had `max` open already is refused with the connect error too-many-connections. Call it
 * before any other io.use(), so that a refused socket costs no token check.
 */
export function connectionCap(
  io: ChatServer,
  { max, ipOf }: { max: number; ipOf: (request: IncomingMessage) => string | undefined },
) {
  /** How many connections each IP address has open, for the addresses that have one. */
  const open = new Map<string, number>()
  /** The connections opened past their address's max, whose sockets are refused. */
  const over = new WeakSet<Connection>()
  io.engine.on('connection', (connection: Connection) => {
    // Read as the connection opens, while its request's own connection is there to read.
    const ip = ipOf(connection.request) ?? ''
    const count = (open.get(ip) ?? 0) + 1
    open.set(ip, count)
    if (count > max) over.add(connection)
    // An address's count goes once its last connection closes, so that the map holds only the
    // addresses with one open.
    connection.once('close', () => {
      const left = (open.get(ip) ?? 1) - 1
      if (left > 0) open.set(ip, left)
      else open.delete(ip)
    })
  })
  // The client's connect_error has the code as its message. Its client then closes the
  // connection, which frees its place; one that keeps it open still holds that place, until
  // Socket.IO closes a connection with no socket on it, 45 s after it opened.
  io.use((socket, next) =>
    over.has(socket.conn) ? next(new Error('too-many-connections' satisfies ErrorCode)) : next(),
  )
}
