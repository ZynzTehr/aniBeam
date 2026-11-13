import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rateLimit } from './rate-limit.ts'

// The sliding window, on a clock the tests move by hand: 5 tries per 10 s, as for messages.

/** A limit of 5 per 10 s, and its clock, at 0 until a test sets it. */
function limit() {
  const clock = { now: 0 }
  return { clock, sends: rateLimit({ limit: 5, windowMs: 10_000, now: () => clock.now }) }
}

/** What `count` tries by `key` get, one after another, all at the clock's time. */
const tries = (sends: ReturnType<typeof limit>['sends'], key: string, count: number) =>
  Array.from({ length: count }, () => sends.take(key))

/** What 5 tries that all pass get. */
const PASSED = Array.from({ length: 5 }, () => undefined)

test('5 tries pass and the 6th is refused, until the oldest has left the window', () => {
  const { clock, sends } = limit()
  assert.deepEqual(tries(sends, 'uid-aki', 5), PASSED)
  // The 6th, and each after it, gets the time until the oldest, made at 0, is 10 s old.
  assert.equal(sends.take('uid-aki'), 10_000)
  clock.now = 9_999
  assert.equal(sends.take('uid-aki'), 1)
  clock.now = 10_000
  assert.equal(sends.take('uid-aki'), undefined)
})

test('the wait is until the oldest try in the window leaves it', () => {
  const { clock, sends } = limit()
  for (const at of [0, 1_000, 2_000, 3_000, 4_000]) {
    clock.now = at
    assert.equal(sends.take('uid-aki'), undefined, String(at))
  }
  clock.now = 4_500
  assert.equal(sends.take('uid-aki'), 5_500)
  // The one at 0 has left, and the one at 1,000 is the oldest now.
  clock.now = 10_000
  assert.equal(sends.take('uid-aki'), undefined)
  assert.equal(sends.take('uid-aki'), 1_000)
})

test("a second user's tries are their own", () => {
  const { sends } = limit()
  tries(sends, 'uid-aki', 6)
  assert.deepEqual(tries(sends, 'uid-rei', 5), PASSED)
  assert.equal(sends.take('uid-rei'), 10_000)
})

test('a window slides: 5 at 9,000 and 5 more at 10,500 refuses the second 5', () => {
  // A fixed window would start again at 10,000 and let 10 through in 1.5 s.
  const { clock, sends } = limit()
  clock.now = 9_000
  assert.deepEqual(tries(sends, 'uid-aki', 5), PASSED)
  clock.now = 10_500
  assert.deepEqual(tries(sends, 'uid-aki', 5), [8_500, 8_500, 8_500, 8_500, 8_500])
  clock.now = 19_000
  assert.equal(sends.take('uid-aki'), undefined)
})

test('a refused try is not counted, so waiting out the window is enough', () => {
  const { clock, sends } = limit()
  tries(sends, 'uid-aki', 5)
  for (const at of [1, 5_000, 9_999]) {
    clock.now = at
    assert.equal(sends.take('uid-aki'), 10_000 - at)
  }
  clock.now = 10_000
  assert.deepEqual(tries(sends, 'uid-aki', 5), PASSED)
})

test('the keys whose tries have all left the window are let go, so memory stays bounded', () => {
  const { clock, sends } = limit()
  for (let user = 0; user < 1_000; user++) sends.take(`uid-${user}`)
  assert.equal(sends.size, 1_000)
  clock.now = 9_999
  sends.take('uid-aki')
  assert.equal(sends.size, 1_001)
  // At 10,000 the 1,000 tries made at 0 have left, and only aki's is kept.
  clock.now = 10_000
  sends.take('uid-rei')
  assert.equal(sends.size, 2)
  clock.now = 30_000
  sends.take('uid-rei')
  assert.equal(sends.size, 1)
})
