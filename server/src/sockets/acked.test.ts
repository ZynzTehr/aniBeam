import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FastifyBaseLogger } from 'fastify'
import { acked } from './acked.ts'

// The listener itself, called as Socket.IO calls it: the payload, then the ack, if any.

/** A logger that keeps what it is given as errors, the one level acked() writes. */
function logger() {
  const errors: unknown[] = []
  const log = { error: (err: unknown) => void errors.push(err) } as unknown as FastifyBaseLogger
  return { log, errors }
}

/** Calls `listener` with `args` and an ack, and resolves with the ack's answer. */
const answer = (listener: (...args: unknown[]) => void, ...args: unknown[]) =>
  new Promise((resolve) => listener(...args, resolve))

test('the payload is the one argument before the ack, or undefined', async () => {
  const { log } = logger()
  const listener = acked(log, async (payload) => ({ payload }))
  assert.deepEqual(await answer(listener, { roomKey: 'anime:1:all' }), {
    payload: { roomKey: 'anime:1:all' },
  })
  assert.deepEqual(await answer(listener), { payload: undefined })
  assert.deepEqual(await answer(listener, 'a', 'b'), { payload: undefined })
})

test('a failure is logged and answered server-error, with nothing of its message', async () => {
  const { log, errors } = logger()
  const failure = new Error('insert into messages failed for uid-secret')
  const listener = acked(log, async () => {
    throw failure
  })
  assert.deepEqual(await answer(listener, {}), { error: 'server-error' })
  assert.deepEqual(errors, [failure])
})

test('a failure with no ack to answer is logged, and ends nothing', async () => {
  const { log, errors } = logger()
  const logged = new Promise<void>((resolve) => {
    log.error = (err: unknown) => {
      errors.push(err)
      resolve()
    }
  })
  acked(log, async () => {
    throw new Error('no ack')
  })({})
  await logged
  assert.equal(errors.length, 1)
})

test('after gets the answer once the ack has sent it, and a failure there is logged', async () => {
  const { log, errors } = logger()
  const order: string[] = []
  const failure = new Error('after failed')
  const logged = new Promise<void>((resolve) => {
    log.error = (err: unknown) => {
      errors.push(err)
      resolve()
    }
  })
  const listener = acked(
    log,
    async () => ({ ok: true }),
    (answer) => {
      order.push(`after ${JSON.stringify(answer)}`)
      throw failure
    },
  )
  listener({}, (answer: unknown) => void order.push(`ack ${JSON.stringify(answer)}`))
  await logged
  assert.deepEqual(order, ['ack {"ok":true}', 'after {"ok":true}'])
  assert.deepEqual(errors, [failure])
})

test('after is not called when handling fails', async () => {
  const { log } = logger()
  let called = false
  const listener = acked(
    log,
    async () => {
      throw new Error('failed')
    },
    () => void (called = true),
  )
  assert.deepEqual(await answer(listener, {}), { error: 'server-error' })
  assert.equal(called, false)
})
