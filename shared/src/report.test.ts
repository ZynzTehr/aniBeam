import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageReportSchema, REPORT_REASONS } from './report.ts'

test('a report is { id, reason }, with a reason of spoiler, abuse, spam or other', () => {
  assert.deepEqual(REPORT_REASONS, ['spoiler', 'abuse', 'spam', 'other'])
  for (const reason of REPORT_REASONS)
    assert.deepEqual(messageReportSchema.parse({ id: 7, reason }), { id: 7, reason })
  assert.equal(messageReportSchema.safeParse({ id: 2 ** 53 - 1, reason: 'spam' }).success, true)
})

test('an id that is not a whole number from 1, another reason, or another key is refused', () => {
  for (const value of [
    { id: 0, reason: 'spam' },
    { id: -1, reason: 'spam' },
    { id: 1.5, reason: 'spam' },
    { id: '1', reason: 'spam' },
    { id: 2 ** 53, reason: 'spam' },
    { id: Number.NaN, reason: 'spam' },
    { id: 1, reason: 'rude' },
    { id: 1, reason: 'SPAM' },
    { id: 1 },
    { reason: 'spam' },
    // Who reports comes from the sign-in: a handle or a user id in the payload is refused.
    { id: 1, reason: 'spam', handle: 'rei' },
    { id: 1, reason: 'spam', uid: 'uid-rei' },
    1,
    null,
    undefined,
  ])
    assert.equal(messageReportSchema.safeParse(value).success, false, String(JSON.stringify(value)))
})
