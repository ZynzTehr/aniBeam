// The sign-in a route for a signed-in user asks for: an Authorization: Bearer <token> header,
// whose token the verifier checks. The uid it proves is the only one the route uses; a user id
// or handle anywhere else in the request is never read as who the request is from.
import type { ErrorCode } from '@anibeam/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { BadToken, type Verify } from './verify.ts'

declare module 'fastify' {
  interface FastifyRequest {
    /** The uid the request's token proved, on a route that signIn's hook guards. */
    uid: string
  }
}

/** Bearer, any case as RFC 6750 allows, then one token with no spaces in it. */
const BEARER = /^Bearer +(\S+)$/i

/**
 * The onRequest hook for routes that need a signed-in user, which sets request.uid. It runs
 * before the body is read, so a request with no good token is refused without reading it: 401
 * sign-in-required with no Authorization header, and 401 bad-token with one that isn't a Bearer
 * token or whose token the verifier refuses. Any other failure of the verifier, such as Google's
 * keys not loading, is the server's, and answers 500. Call it once for an app.
 */
export function signIn(app: FastifyInstance, verify: Verify) {
  app.decorateRequest('uid', '')
  const refuse = (reply: FastifyReply, error: ErrorCode) =>
    reply.code(401).header('www-authenticate', 'Bearer').send({ error })
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization
    if (header === undefined) return refuse(reply, 'sign-in-required')
    const token = BEARER.exec(header)?.[1]
    if (token === undefined) return refuse(reply, 'bad-token')
    try {
      request.uid = (await verify(token)).uid
    } catch (err) {
      if (err instanceof BadToken) return refuse(reply, 'bad-token')
      throw err
    }
  }
}
