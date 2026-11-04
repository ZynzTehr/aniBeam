// Socket.IO (D14): a connection that stays open, so that the server can send each new message to
// a room's viewers the moment it is saved, where HTTP only answers what it is asked. It shares
// Fastify's HTTP server, and so its port: requests under /socket.io/ go to Socket.IO, the rest to
// Fastify's routes.
import type { FastifyInstance } from 'fastify'
import { Server, type DefaultEventsMap, type Socket } from 'socket.io'

/** What the server keeps on each socket. */
export interface SocketData {
  /**
   * The uid the handshake's token proved, or undefined on a signed-out socket, which may join
   * rooms and read but not send.
   */
  uid?: string
}

/** The chat server's Socket.IO server. Each payload is checked as it comes, so events are untyped. */
export type ChatServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>
/** One client's socket on it. */
export type ChatSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>

declare module 'fastify' {
  interface FastifyInstance {
    /** The app's Socket.IO server, which sends to rooms. */
    io: ChatServer
  }
}

/**
 * The largest packet a client may send, 16 KB: a polling client can send several messages in
 * one request, and five of 500 emoji are about 10 KB (fixed choice 4). A larger one closes the
 * socket. Each message still has its own limit of 500 code points.
 */
export const MAX_PACKET = 16 * 1024

/**
 * Attaches Socket.IO to `app`'s HTTP server, as app.io. `allows` is the CORS hook's check of an
 * origin (cors.ts), so that sockets take the same websites' pages as REST. `serveClient` serves
 * Socket.IO's browser file at /socket.io/socket.io.min.js, for the dev entry's page.
 */
export function sockets(
  app: FastifyInstance,
  options: { allows: (origin: string | undefined) => boolean; serveClient: boolean },
) {
  const io: ChatServer = new Server(app.server, {
    serveClient: options.serveClient,
    maxHttpBufferSize: MAX_PACKET,
    // The request that opens a connection, over polling or as a WebSocket upgrade, is checked
    // here before Socket.IO reads it. CORS covers none of a WebSocket: a browser opens one to any
    // site without asking first, sending its page's origin, so the server must refuse that
    // origin itself. A request with no Origin is refused too, since a browser always sends one.
    allowRequest: (request, callback) => callback(null, options.allows(request.headers.origin)),
  })
  app.decorate('io', io)
  // app.close() waits for every connection to end, and a socket's stays open, so they are closed
  // first. A client whose server went away this way connects again, as it should when a host
  // restarts the server.
  app.addHook('preClose', async () => {
    io.engine.close()
  })
  return io
}
