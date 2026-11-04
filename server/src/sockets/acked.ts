// An event a client sends with an ack: a function of Socket.IO's, its last argument, that sends
// the server's answer back to the client. A client may send anything, so the listener takes
// nothing on trust: not that there is a payload, nor an ack, nor that handling it can't fail.
import type { ErrorCode } from '@anibeam/shared'
import type { FastifyBaseLogger } from 'fastify'

/**
 * A listener for an event whose one argument is its payload, answered by `handle`. A missing
 * payload, or more than one argument, reaches `handle` as undefined, which it refuses. With no
 * ack, the event is still handled, and the answer goes nowhere. A failure of `handle` is logged
 * and answered server-error: a listener that threw, or whose promise was refused unheard, would
 * end the process.
 */
export function acked<Answer>(
  log: FastifyBaseLogger,
  handle: (payload: unknown) => Promise<Answer>,
) {
  return (...args: unknown[]) => {
    const ack =
      typeof args.at(-1) === 'function' ? (args.pop() as (answer: unknown) => void) : undefined
    const payload = args.length === 1 ? args[0] : undefined
    void handle(payload).then(
      (answer) => ack?.(answer),
      (err: unknown) => {
        log.error(err)
        ack?.({ error: 'server-error' satisfies ErrorCode })
      },
    )
  }
}
