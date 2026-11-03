// The one list of error codes the chat server answers with, over REST and in socket acks, so
// that web/ can tell each refusal apart. Each code joins the list in the PR that first uses it.
// A 500, a failure of the server's own, is the one answer without a code: its body is
// {"statusCode": 500, "error": "Internal Server Error"}, so web/ tells it by its status and never
// reads its error as one of these.
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
  // Someone has this handle already, written in any case. REST answers it with 409.
  'handle-taken',
  // The user has picked a handle, and a handle is set once. REST answers it with 409.
  'handle-already-set',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
