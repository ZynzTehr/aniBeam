// The one list of error codes the chat server answers with, over REST and in socket acks, so
// that web/ can tell each refusal apart. Each code joins the list in the PR that first uses it.
export const ERROR_CODES = [
  // The request itself is wrong: a bad room key, cursor or payload. REST answers it with 400.
  'invalid',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
