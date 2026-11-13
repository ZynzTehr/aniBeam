import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { buildApp } from '../app.ts'
import { ask, client, connected, heard, listen, next, ORIGIN, within } from '../testing/sockets.ts'
import { MAX_ROOMS } from './rooms.ts'
import type { ChatSocket } from './sockets.ts'

// join and leave, which a signed-out socket may send too (D12), so these sockets have no token.

const ROOM = 'anime:154587:ep:5'

/** A listening app, a client connected to it, and the server's side of that client's socket. */
async function joiner(t: TestContext) {
  const app = buildApp({ corsOrigins: [ORIGIN] })
  const url = await listen(t, app)
  const arrived = next<ChatSocket>(app.io, 'connection')
  const socket = client(t, url)
  await within(connected(socket), 'connected')
  return { app, socket, server: await arrived }
}

test('join answers ok once the socket is in the room: a message sent then reaches it', async (t) => {
  const { app, socket, server } = await joiner(t)
  // Whether the socket was in the room as the server wrote its ack, an ACK packet of Socket.IO's,
  // which begins with 3, so that an ack sent before the join fails however soon the join follows.
  let inRoomAtAck: boolean | undefined
  server.conn.on('packetCreate', (packet: { type: string; data?: unknown }) => {
    if (packet.type === 'message' && String(packet.data).startsWith('3'))
      inRoomAtAck ??= server.rooms.has(ROOM)
  })
  assert.deepEqual(await ask(socket, 'join', { roomKey: ROOM }), { ok: true })
  assert.equal(inRoomAtAck, true)
  // Sent the moment the ack arrives, with no wait.
  const message = next(socket, 'test:room')
  app.io.to(ROOM).emit('test:room', 'hello')
  assert.equal(await message, 'hello')
  assert.ok(server.rooms.has(ROOM))
})

test('a bad room key, or a payload that is not { roomKey } alone, answers invalid', async (t) => {
  const { socket, server } = await joiner(t)
  for (const args of [
    [{ roomKey: 'anime:0:all' }],
    [{ roomKey: 'anime:1:all', uid: 'uid-aki' }],
    ['anime:1:all'],
    [null],
    // No payload, and a payload with more after it.
    [],
    [{ roomKey: 'anime:1:all' }, 'more'],
  ]) {
    assert.deepEqual(await ask(socket, 'join', ...args), { error: 'invalid' }, JSON.stringify(args))
    assert.deepEqual(
      await ask(socket, 'leave', ...args),
      { error: 'invalid' },
      JSON.stringify(args),
    )
  }
  // In no room but its own.
  assert.deepEqual([...server.rooms], [server.id])
})

test(`a socket may be in ${MAX_ROOMS} rooms: a 6th answers too-many-rooms`, async (t) => {
  const { app, socket, server } = await joiner(t)
  const rooms = Array.from({ length: MAX_ROOMS + 1 }, (_, i) => `anime:1:ep:${i + 1}`)
  for (const roomKey of rooms.slice(0, MAX_ROOMS))
    assert.deepEqual(await ask(socket, 'join', { roomKey }), { ok: true }, roomKey)
  const sixth = { roomKey: rooms[MAX_ROOMS] }
  assert.deepEqual(await ask(socket, 'join', sixth), { error: 'too-many-rooms' })
  assert.equal(server.rooms.has(sixth.roomKey), false)
  // Joining one it is in again is no 6th.
  assert.deepEqual(await ask(socket, 'join', { roomKey: rooms[0] }), { ok: true })
  app.io.to(sixth.roomKey).emit('test:room')
  assert.deepEqual(await heard(socket, server), [])
  // And after a leave, there is room for it.
  assert.deepEqual(await ask(socket, 'leave', { roomKey: rooms[0] }), { ok: true })
  assert.deepEqual(await ask(socket, 'join', sixth), { ok: true })
})

test('leave answers ok, and the socket gets nothing more from the room', async (t) => {
  const { app, socket, server } = await joiner(t)
  assert.deepEqual(await ask(socket, 'join', { roomKey: ROOM }), { ok: true })
  app.io.to(ROOM).emit('test:room')
  assert.deepEqual(await heard(socket, server), ['test:room'])
  assert.deepEqual(await ask(socket, 'leave', { roomKey: ROOM }), { ok: true })
  app.io.to(ROOM).emit('test:room')
  assert.deepEqual(await heard(socket, server), [])
  // Leaving a room it isn't in is ok too.
  assert.deepEqual(await ask(socket, 'leave', { roomKey: 'anime:1:all' }), { ok: true })
})

test('a join or leave with no ack, or with nothing at all, harms nothing', async (t) => {
  const { socket, server } = await joiner(t)
  socket.emit('join')
  socket.emit('leave')
  socket.emit('join', 'anime:1:all', 'more')
  // With no ack, a good join is still made.
  socket.emit('join', { roomKey: ROOM })
  // The server is still there, and answers the next.
  assert.deepEqual(await ask(socket, 'join', { roomKey: 'anime:1:all' }), { ok: true })
  assert.deepEqual([...server.rooms].sort(), [server.id, ROOM, 'anime:1:all'].sort())
  assert.ok(socket.connected)
})
