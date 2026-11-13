// At most 10 connections open at once from one IP address (D12), so that one computer can't
// open thousands and tie the server up. The count is kept on the raw connection, Engine.IO's,
// beneath Socket.IO's sockets (fixed choice 2): up when it opens, down when it closes, whatever
// became of it. A connection refused for a bad token never becomes a socket, and so never
// "disconnects": counted on Socket.IO's own events, each refusal would leave its count behind,
// and a few bad tries would lock an honest user out. A connection past the 10th is closed by the
// server itself, once its refusal has gone out, or after a short grace if it never asks for a
// socket. And once an address has 10 more open, waiting for their refusals, its next requests are
// refused before they become connections at all: a script that ignores refusals holds 20 at most.
import type { ErrorCode } from '@anibeam/shared'
import type { IncomingMessage } from 'node:http'
import type { ChatServer, ChatSocket } from '../sockets/sockets.ts'

/** The most connections one IP address may have open at once (D12). */
export const MAX_CONNECTIONS_PER_IP = 10

/**
 * How long a connection past its address's max stays open for its refusal, in ms. A Socket.IO
 * client asks for its socket as soon as the connection opens, one round trip, so 2 s is plenty
 * for it to hear the code; a client that hasn't asked by then is closed with none.
 */
export const REFUSAL_GRACE_MS = 2000

/** A raw connection, beneath a socket. */
type Connection = ChatSocket['conn']

/**
 * Counts connections by the IP address each comes from, as `ipOf` reads it from the request
 * that opened it (app.clientIp, client-ip.ts). attach(io) counts `io`'s: a socket on a connection
 * opened while its IP had `max` open already is refused with the connect error
 * too-many-connections, and the connection closed once the refusal is sent, or `graceMs` after it
 * opened. Call it before any other io.use(), so that a refused socket costs no token check.
 * admits(request) is for Socket.IO's allowRequest: false once the request's IP has `max` open and
 * `max` more past it, so that a flood of them never becomes connections.
 */
export function connectionCap({
  max,
  ipOf,
  graceMs,
}: {
  max: number
  ipOf: (request: IncomingMessage) => string | undefined
  graceMs: number
}) {
  /** How many connections each IP address has open, for the addresses that have one. */
  const open = new Map<string, number>()
  /** The connections opened past their address's max, whose sockets are refused. */
  const over = new WeakSet<Connection>()
  return {
    // A request refused here gets no code: Socket.IO's client says "websocket error" or "xhr
    // poll error". A client that heeds its refusal closes on it, so only one that ignores them
    // has 10 waiting at once.
    admits: (request: IncomingMessage) => (open.get(ipOf(request) ?? '') ?? 0) < 2 * max,
    attach(io: ChatServer) {
      io.engine.on('connection', (connection: Connection) => {
        // Read as the connection opens, while its request's own connection is there to read.
        const ip = ipOf(connection.request) ?? ''
        const count = (open.get(ip) ?? 0) + 1
        open.set(ip, count)
        if (count > max) {
          over.add(connection)
          // Whatever its client does, or doesn't: one that never asks for a socket would
          // otherwise stay open until Socket.IO's connect timeout, 45 s, past the count.
          const grace = setTimeout(() => connection.close(true), graceMs)
          connection.once('close', () => clearTimeout(grace))
        }
        // An address's count goes once its last connection closes, so that the map holds only
        // the addresses with one open.
        connection.once('close', () => {
          const left = (open.get(ip) ?? 1) - 1
          if (left > 0) open.set(ip, left)
          else open.delete(ip)
        })
      })
      // The client's connect_error has the code as its message. The connection is closed once the
      // refusal has gone out to it ('drain'), without waiting for its client to close it, which a
      // Socket.IO client does but a script needn't. close(true) drops it at once: over polling, a
      // plain close() would wait up to 30 s for the client's next request, to send the close in.
      io.use((socket, next) => {
        if (!over.has(socket.conn)) return next()
        const connection = socket.conn
        connection.once('drain', () => connection.close(true))
        next(new Error('too-many-connections' satisfies ErrorCode))
      })
    },
  }
}
