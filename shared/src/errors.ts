// The one list of error codes the chat server answers with, over REST and in socket acks, so
// that web/ can tell each refusal apart. Each code joins the list in the PR that first uses it.
export const ERROR_CODES = [
  // The request itself is wrong: a bad room key, cursor or payload. REST answers it with 400.
  'invalid',
  // Nothing is there: an address no REST route has.
  'not-found',
  // A route for a signed-in user, asked with no token. REST answers it with 401.
  'sign-in-required',
  // A token that proves nothing: forged, expired, for another project, or not a Bearer token.
  // REST answers it with 401.
  'bad-token',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
