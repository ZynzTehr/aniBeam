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
import { isIP } from 'node:net'
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
 * What `address` counts as: an IPv4 address as itself, written as IPv6 too (::ffff:10.0.0.2 is
 * 10.0.0.2), and an IPv6 address by its first 64 bits, its /64. A home line or a rented server
 * is given a whole /64, and may use any address in it, so counted one by one, a single computer
 * could take 10 places as many times as it liked.
 */
export function countedAs(address: string) {
  if (isIP(address) !== 6) return address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return mapped[1]
  // An IPv4 address at the end is two groups. :: stands for as many groups of 0 as are missing.
  const groups = (part: string) =>
    part === ''
      ? []
      : part.split(':').flatMap((group) => {
          if (!group.includes('.')) return [group]
          const [a, b, c, d] = group.split('.').map(Number)
          return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)]
        })
  const [head, tail] = address.split('%')[0].split('::')
  const left = groups(head)
  const right = tail === undefined ? [] : groups(tail)
  const zeros = Array<string>(8 - left.length - right.length).fill('0')
  const first = [...left, ...zeros, ...right].slice(0, 4)
  return `${first.map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`
}

/**
 * Counts connections by the IP address each comes from, as `ipOf` reads it from the request
 * that opened it (app.clientIp, client-ip.ts), an IPv6 one by its /64 (countedAs). attach(io)
 * counts `io`'s: a socket on a connection opened while its IP had `max` open already is refused
 * with the connect error too-many-connections, and the connection closed once the refusal is
 * sent, or `graceMs` after it opened. A connection's second socket is refused with it too. Call
 * it before any other io.use(), so that a refused socket costs no token check.
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
  /** How many connections each address has open, by countedAs(), for those that have one. */
  const open = new Map<string, number>()
  const addressOf = (request: IncomingMessage) => countedAs(ipOf(request) ?? '')
  /** The connections opened past their address's max, whose sockets are refused. */
  const over = new WeakSet<Connection>()
  /** The connections that have asked for their socket. */
  const asked = new WeakSet<Connection>()
  return {
    // A request refused here gets no code: Socket.IO's client says "websocket error" or "xhr
    // poll error". A client that heeds its refusal closes on it, so only one that ignores them
    // has 10 waiting at once.
    admits: (request: IncomingMessage) => (open.get(addressOf(request)) ?? 0) < 2 * max,
    attach(io: ChatServer) {
      io.engine.on('connection', (connection: Connection) => {
        // Read as the connection opens, while its request's own connection is there to read.
        const ip = addressOf(connection.request)
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
        const connection = socket.conn
        const refuse = () => next(new Error('too-many-connections' satisfies ErrorCode))
        if (over.has(connection)) {
          connection.once('drain', () => connection.close(true))
          return refuse()
        }
        // One socket to a connection: a Socket.IO client asks for its socket once on each, and
        // opens a new connection to ask again. Asked twice at once, Socket.IO would make a second
        // before the first is done, and a script asking thousands of times would have thousands
        // of sockets on one connection of its 10. The others are refused before their token check.
        if (asked.has(connection)) return refuse()
        asked.add(connection)
        next()
      })
    },
  }
}
