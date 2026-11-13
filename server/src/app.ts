import type { ErrorCode } from '@anibeam/shared'
import { drizzle } from 'drizzle-orm/node-postgres'
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify'
import { STATUS_CODES, type IncomingMessage } from 'node:http'
import type pg from 'pg'
import type { Verify } from './auth/verify.ts'
import { clientIp, proxyTrust, type TrustProxy } from './client-ip.ts'
import { cors } from './cors.ts'
import { logFailure } from './failure.ts'
import { historyRoutes } from './routes/history.ts'
import { meRoutes } from './routes/me.ts'
import { sockets } from './sockets/sockets.ts'

/**
 * What the log writes as [Redacted]: the Authorization header, which holds a sign-in token, in
 * headers logged on their own or in a request logged whole. Fastify's own request log has no
 * headers, so these are for any log line that adds them.
 */
export const REDACT = ['headers.authorization', '*.headers.authorization']

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The IP address `request` comes from, by the app's trustProxy (client-ip.ts): what
     * request.ip says on REST, for a request Fastify never sees, as a socket's.
     */
    clientIp(request: IncomingMessage): string | undefined
  }
}

// The chat server's routes, without listening, so that tests can call them through app.inject.
// The routes that read the database, and message:send, come with a pool of connections to it;
// the pool belongs to the caller, who closes it. `verify` checks sign-in tokens: the production
// entry passes Firebase's (auth/verify.ts), the dev entry its own, and tests one of their own.
// The routes for a signed-in user come with both a pool and `verify`. `corsOrigins` are the web
// app's origins, whose pages may read the answers (CORS_ORIGIN, cors.ts), and open sockets; with
// none, no website's may. `serveClient` serves Socket.IO's browser file, which only the dev
// entry's page loads. `logger` is true to log to stdout, or a stream for a test to read.
// `trustProxy` is the proxies trusted to say each client's IP (TRUST_PROXY), none if unset.
// `now` is the clock the limits read, in ms, for tests to set by hand.
export function buildApp(
  options: {
    corsOrigins?: readonly string[]
    logger?: boolean | { stream: { write(line: string): void } }
    now?: () => number
    pool?: pg.Pool
    serveClient?: boolean
    trustProxy?: TrustProxy
    verify?: Verify
  } = {},
) {
  const { logger = false } = options
  const trusts = proxyTrust(options.trustProxy)
  const { allows, headers, hook } = cors(options.corsOrigins ?? [])
  // 4 KB holds any request the chat makes (a message is at most 500 code points), and a body
  // larger than that is refused with 413 before it is read.
  const app = Fastify({
    logger: logger && { ...(logger === true ? {} : logger), redact: REDACT },
    bodyLimit: 4096,
    // request.ip by the same check of each hop as clientIp() (client-ip.ts), or the connection's
    // address with no proxy trusted. Never true, which takes the leftmost forwarded address, and
    // never a number, which Fastify takes as trusting no hop at all.
    trustProxy: trusts ?? false,
    // An address Fastify refuses before any route sees it, a bad %-escape or a part over 100
    // characters (such as a room key), gets the answer of any other bad request of ours. No hook
    // runs for it, so it gets the CORS headers here.
    frameworkErrors: (err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      headers(request, reply)
      if (err.code === 'FST_ERR_BAD_URL' || err.code === 'FST_ERR_MAX_PARAM_LENGTH')
        return reply.code(400).send({ error: 'invalid' satisfies ErrorCode })
      return reply.send(err)
    },
    // A request Node can't read as HTTP, such as a broken first line or headers over 16 KB, never
    // reaches Fastify's routes. Fastify answers it straight on the connection, as Node does, so
    // this is that answer with our body.
    clientErrorHandler: (err, socket) => {
      if (err.code === 'ECONNRESET' || socket.destroyed) return
      const status =
        err.code === 'ERR_HTTP_REQUEST_TIMEOUT'
          ? 408
          : err.code === 'HPE_HEADER_OVERFLOW'
            ? 431
            : 400
      const body = JSON.stringify({ error: 'invalid' satisfies ErrorCode })
      if (socket.writable)
        socket.write(
          `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nContent-Length: ${body.length}\r\n` +
            `Content-Type: application/json; charset=utf-8\r\nConnection: close\r\n\r\n${body}`,
        )
      socket.destroy(err)
    },
  })

  app.decorate('clientIp', (request: IncomingMessage) => clientIp(request, trusts))

  // First, before any route: the CORS headers on every answer, and the preflight's answer.
  app.addHook('onRequest', hook)

  // Every refusal answers {"error": <code>} with a code from shared's list, Fastify's own as well
  // as ours, so that web/ reads the field as a code on every answer. An address no route has is
  // not-found. The rest Fastify refuses (bad JSON, a body over 4 KB, a content type no route
  // reads) is invalid, and its status (400, 413, 415) says which.
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not-found' satisfies ErrorCode }),
  )

  // A failure of ours (a 5xx) is logged (failure.ts, which leaves a failed query's values out),
  // and answered 500 server-error alone, without its message or stack, which can hold the SQL
  // that failed.
  app.setErrorHandler((err: { statusCode?: number }, request, reply) => {
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500)
      return reply.code(err.statusCode).send({ error: 'invalid' satisfies ErrorCode })
    logFailure(request.log, err)
    return reply.code(500).send({ error: 'server-error' satisfies ErrorCode })
  })

  const db = options.pool && drizzle({ client: options.pool })
  // The sockets, on the server Fastify made, which listens when the app does.
  sockets(app, {
    allows,
    db,
    // A clock that never goes back, as the computer's can when it is set.
    now: options.now ?? (() => performance.now()),
    serveClient: options.serveClient ?? false,
    verify: options.verify,
  })

  app.get('/health', async () => ({ ok: true }))
  if (db) {
    historyRoutes(app, db)
    if (options.verify) meRoutes(app, db, options.verify)
  }

  return app
}
