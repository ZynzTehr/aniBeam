import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageSendSchema } from './message.ts'

const ROOM = 'anime:154587:ep:5'

/** The payload's body once checked, or undefined if the payload is refused. */
const body = (value: unknown) => {
  const parsed = messageSendSchema.safeParse(value)
  return parsed.success ? parsed.data.body : undefined
}

test('a message is { roomKey, body, spoiler }, and its body is trimmed', () => {
  assert.deepEqual(messageSendSchema.parse({ roomKey: ROOM, body: 'hello', spoiler: true }), {
    roomKey: ROOM,
    body: 'hello',
    spoiler: true,
  })
  assert.equal(body({ roomKey: ROOM, body: '  hello \n', spoiler: false }), 'hello')
  // Every kind of space JavaScript trims, a no-break space and an ideographic one among them.
  assert.equal(body({ roomKey: ROOM, body: ' hi　', spoiler: false }), 'hi')
})

test('a body of 500 code points passes, and 501 or spaces alone are refused', () => {
  // An emoji is two UTF-16 units and one code point, as the database's char_length counts it.
  const emoji = '\u{1F600}'
  assert.equal(body({ roomKey: ROOM, body: emoji.repeat(500), spoiler: false }), emoji.repeat(500))
  assert.equal(body({ roomKey: ROOM, body: 'a'.repeat(500), spoiler: false }), 'a'.repeat(500))
  // Spaces around a full body are trimmed before it is counted.
  assert.equal(
    body({ roomKey: ROOM, body: ` ${'a'.repeat(500)} `, spoiler: false }),
    'a'.repeat(500),
  )
  for (const refused of [emoji.repeat(501), 'a'.repeat(501), '', '   ', '\n\t '])
    assert.equal(body({ roomKey: ROOM, body: refused, spoiler: false }), undefined, refused)
})

test('a NUL, or half a surrogate pair alone, is refused', () => {
  for (const refused of ['a\0b', 'a\uD83Db', '\uDE00'])
    assert.equal(body({ roomKey: ROOM, body: refused, spoiler: false }), undefined)
})

test('a bad room key, a spoiler that is not true or false, or another key is refused', () => {
  for (const value of [
    { roomKey: 'anime:0:all', body: 'hi', spoiler: false },
    { roomKey: ROOM, body: 'hi' },
    { roomKey: ROOM, body: 'hi', spoiler: 'true' },
    { roomKey: ROOM, body: 'hi', spoiler: 1 },
    { roomKey: ROOM, body: 42, spoiler: false },
    // Who sends it comes from the sign-in: a handle or a user id in the payload is refused.
    { roomKey: ROOM, body: 'hi', spoiler: false, handle: 'rei' },
    { roomKey: ROOM, body: 'hi', spoiler: false, uid: 'uid-rei' },
    'hi',
    null,
    undefined,
  ])
    assert.equal(messageSendSchema.safeParse(value).success, false, JSON.stringify(value))
})
