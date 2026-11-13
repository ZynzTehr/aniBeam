// What a client sends to report a message (spec section 7): message:report's payload.
import * as z from 'zod/mini'

/** Why a message is reported, the reasons the reports table takes. */
export const REPORT_REASONS = ['spoiler', 'abuse', 'spam', 'other'] as const

/**
 * message:report's payload: { id, reason }, with no other key. The id is a saved message's, a
 * whole number from 1 that JavaScript holds. Who reports it comes from the socket's sign-in,
 * never from the payload.
 */
export const messageReportSchema = z.strictObject({
  id: z.int().check(z.positive()),
  reason: z.enum(REPORT_REASONS),
})

export type MessageReport = z.infer<typeof messageReportSchema>
