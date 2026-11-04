// The one list of error codes the chat server answers with, over REST and in socket acks, so
// that web/ can tell each refusal apart. Each code joins the list in the PR that first uses it.
export const ERROR_CODES = [
  // The request itself is wrong: a bad room key, cursor or payload. REST answers it with 400.
  'invalid',
  // Nothing is there: an address no REST route has.
  'not-found',
  // A route for a signed-in user, asked with no token, or a message sent from a signed-out
  // socket. REST answers it with 401.
  'sign-in-required',
  // A token that proves nothing: forged, expired, for another project, or not a Bearer token.
  // REST answers it with 401.
  'bad-token',
  // Someone has this handle already, written in any case. REST answers it with 409.
  'handle-taken',
  // The user has picked a handle, and a handle is set once. REST answers it with 409.
  'handle-already-set',
  // A socket in the most rooms it may be in at once (5) asked to join another. Its ack says it.
  'too-many-rooms',
  // A signed-in user with no handle yet sent a message: a message shows its handle, so the user
  // picks one first (POST /me/handle).
  'handle-required',
  // A message sent to a room the socket hasn't joined.
  'not-joined',
  // A failure of the server's own, such as the database being down, and not the request's.
  // REST answers it with 500, and a socket ack for a message that failed to save says it too,
  // with no stack, SQL or message, which can hold a user's uid or the SQL that failed.
  'server-error',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
