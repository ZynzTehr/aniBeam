// CORS (D10): which websites' pages may read the chat server's answers. A browser sends a
// request's page origin in its Origin header, and lets the page read the answer only if
// Access-Control-Allow-Origin names that origin. The server names only the web app's origins
// (CORS_ORIGIN), each matched exactly as written, so a lookalike, such as a host that starts
// with the web app's, or "null", the origin of a file or a sandboxed page, gets none. Origin
// stops other websites, not scripts, which can send any Origin; the sign-in and the limits are
// for those.
import type { FastifyReply, FastifyRequest } from 'fastify'

/** The methods the REST routes use. */
const METHODS = 'GET, POST'
/** The headers a request to them may carry beyond the ones a browser always may. */
const HEADERS = 'Authorization, Content-Type'
/** How long a browser may keep a preflight's answer, in seconds. */
const MAX_AGE = '600'

/**
 * The CORS headers for `origins`: `headers` sets them on any answer, and `hook`, an onRequest
 * hook, sets them and answers the preflight. A browser sends a preflight (OPTIONS with
 * Access-Control-Request-Method) before a request with Authorization or a JSON body, to ask
 * whether it may send it. `allows` says whether an origin is one of them, for the sockets'
 * check (sockets/sockets.ts).
 */
export function cors(origins: readonly string[]) {
  const allowed = new Set(origins)
  const allows = (origin: string | undefined) => origin !== undefined && allowed.has(origin)
  /** Sets the headers, and says whether the request's origin is allowed. */
  const headers = (request: FastifyRequest, reply: FastifyReply) => {
    // Always, since the answer depends on the Origin: a cache must not give one origin's answer
    // to another.
    reply.header('vary', 'Origin')
    const { origin } = request.headers
    if (origin === undefined || !allows(origin)) return false
    reply.header('access-control-allow-origin', origin)
    return true
  }
  const hook = async (request: FastifyRequest, reply: FastifyReply) => {
    const ok = headers(request, reply)
    if (request.method !== 'OPTIONS' || !request.headers['access-control-request-method']) return
    // An origin not allowed gets no allow headers, so its browser sends nothing more. No
    // Access-Control-Allow-Credentials: the token goes in a header, and no route reads cookies.
    if (ok)
      reply
        .header('access-control-allow-methods', METHODS)
        .header('access-control-allow-headers', HEADERS)
        .header('access-control-max-age', MAX_AGE)
    return reply.code(204).send()
  }
  return { allows, headers, hook }
}
