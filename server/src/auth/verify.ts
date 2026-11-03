// Checks a sign-in token, the only proof of who a request is from: the server never takes a user
// id or a handle from the client. The token is a Firebase ID token, a JWT that Google signs with
// one of its securetoken keys. jose checks the signature against the keys Google publishes, and
// the claims as Firebase's rules for verifying ID tokens ask, with jose's checks or by hand.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

/** Turns a sign-in token into the uid of the user it proves, or rejects with BadToken. */
export type Verify = (token: string) => Promise<{ uid: string }>

/**
 * A token that proves nothing: forged, expired, for another project, or no token at all. Its
 * message says which check failed, as jose's error code and the claim's name, never the token
 * or its claims, which hold the user's email.
 */
export class BadToken extends Error {
  name = 'BadToken'
}

/** Where Google publishes the keys that sign Firebase ID tokens, as a JWK set. */
export const GOOGLE_KEYS = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
)

/** How far a token's times may be from this server's clock, in seconds, for clocks a little off. */
export const CLOCK_TOLERANCE = 5

/** Firebase's longest uid. */
const UID_MAX = 128

/**
 * jose's codes for a token that fails a check. Any other error, such as Google's keys not
 * loading, is the server's trouble and not the token's, so it goes on as it is.
 */
const REFUSED = new Set([
  'ERR_JWS_INVALID',
  'ERR_JWT_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
])

/**
 * The verifier for tokens from the Firebase project `projectId`. Without a project, outside
 * production, every token is refused. `keys` is where the signing keys are, Google's unless a
 * test serves its own.
 */
export function firebaseVerifier(projectId: string | undefined, keys = GOOGLE_KEYS): Verify {
  // jose keeps the keys it fetched for 10 minutes, and asks sooner only for a key id it hasn't
  // seen, at most every 30 s.
  const googleKeys = createRemoteJWKSet(keys)
  return async (token) => {
    if (!projectId) throw new BadToken('no FIREBASE_PROJECT_ID')
    let claims: JWTPayload
    try {
      claims = (
        await jwtVerify(token, googleKeys, {
          // Google signs with RS256 only. Naming it refuses alg none, and HS256 made with the
          // public key as its secret, before any key is looked up.
          algorithms: ['RS256'],
          issuer: `https://securetoken.google.com/${projectId}`,
          audience: projectId,
          // jose checks exp (and nbf), and that each of these is there.
          requiredClaims: ['exp', 'iat', 'auth_time', 'sub'],
          clockTolerance: CLOCK_TOLERANCE,
        })
      ).payload
    } catch (err) {
      // jose's error holds the claims, so only its code, and the name of the claim that failed,
      // go on.
      const { code, claim } = err as { code?: unknown; claim?: unknown }
      if (typeof code === 'string' && REFUSED.has(code))
        throw new BadToken(typeof claim === 'string' ? `${code} (${claim})` : code)
      throw err
    }
    // jose checks iat is a number but not that it has passed, and leaves auth_time to us.
    const latest = Date.now() / 1000 + CLOCK_TOLERANCE
    if (typeof claims.iat !== 'number' || claims.iat > latest) throw new BadToken('iat')
    if (typeof claims.auth_time !== 'number' || claims.auth_time > latest)
      throw new BadToken('auth_time')
    const { sub } = claims
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > UID_MAX)
      throw new BadToken('sub')
    // The uid alone: the claims, with the email in them, go no further than this function.
    return { uid: sub }
  }
}
