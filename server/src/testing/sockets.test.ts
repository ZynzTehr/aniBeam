import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { test } from 'node:test'
import { onFreePort } from './sockets.ts'

/** Listens on `port` of 127.0.0.1, or rejects with listen's error. */
async function listenOn(server: Server, port: number) {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return server
}

test('onFreePort starts again on another port when another process took the first', async (t) => {
  const servers: Server[] = []
  t.after(() => servers.forEach((server) => server.close()))
  const ports: number[] = []
  const { port, started } = await onFreePort(async (port) => {
    ports.push(port)
    // The first time, another process takes the port between freePort() and the listen.
    if (ports.length === 1) servers.push(await listenOn(createServer(), port))
    const server = createServer()
    servers.push(server)
    return listenOn(server, port)
  })
  assert.equal(ports.length, 2)
  assert.notEqual(ports[0], ports[1])
  assert.equal(port, ports[1])
  assert.equal((started.address() as AddressInfo).port, port)
})

test('onFreePort fails at once on any other failure, and after 3 tries taken', async () => {
  let tries = 0
  const failing = (message: string) => async () => {
    tries++
    throw new Error(message)
  }
  await assert.rejects(onFreePort(failing('no database')), /no database/)
  assert.equal(tries, 1)
  tries = 0
  await assert.rejects(onFreePort(failing('listen EADDRINUSE')), /EADDRINUSE/)
  assert.equal(tries, 3)
})
