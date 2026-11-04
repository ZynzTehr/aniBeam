// Socket.IO clients for the server's tests, as a browser's would connect. Each waits on an event
// or an ack, never on a fixed time, which bounds only a failure.
import type { TestContext } from 'node:test'
import { createServer, type AddressInfo } from 'node:net'
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import type { buildApp } from '../app.ts'
import type { ChatSocket } from '../sockets/sockets.ts'

/** The origin the tests' apps allow, as the web app's would be. */
export const ORIGIN = 'https://ani-beam.vercel.app'

/** How long a test waits for an event before it fails, in ms. */
export const WAIT = 2000

/** Listens on a free port of 127.0.0.1, closes the app after the test, and gives its address. */
export async function listen(t: TestContext, app: ReturnType<typeof buildApp>) {
  await app.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => app.close())
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
}

/** A client's options, and the Origin it sends: ORIGIN unless given, and none if null. */
export type ClientOptions = Partial<ManagerOptions & SocketOptions> & { origin?: string | null }

/**
 * A client of `url`, as a page from `options.origin` opens one, over WebSocket alone unless
 * `options` says otherwise. It never connects again on its own, and closes after the test.
 */
export function client(
  t: TestContext,
  url: string,
  { origin = ORIGIN, ...options }: ClientOptions = {},
) {
  const socket = io(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...(origin !== null && { extraHeaders: { origin } }),
    ...options,
  })
  t.after(() => socket.close())
  return socket
}

/** Resolves once `socket` connects, or rejects with its connect_error. */
export function connected(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
}

/** Sends `event` with `args` and an ack, and resolves with the server's answer, or rejects after WAIT. */
export function ask(socket: Socket, event: string, ...args: unknown[]): Promise<unknown> {
  return socket.timeout(WAIT).emitWithAck(event, ...args)
}

/** Resolves with the first `event` on `emitter`, or rejects after WAIT. */
export function next<T = unknown>(
  emitter: { once(event: string, listener: (value: T) => void): unknown },
  event: string,
) {
  return within(new Promise<T>((resolve) => emitter.once(event, resolve)), `no ${event}`)
}

/** `promise`, or a rejection saying `what` after WAIT. */
export function within<T>(promise: Promise<T>, what: string) {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} within ${WAIT} ms`)), WAIT)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/**
 * Starts keeping the events `socket` gets, and gives a function that resolves with them, up to a
 * mark the server sends it alone after whatever the test sent: a socket's packets arrive in the
 * order they were sent, so an event sent before the mark that reaches the socket at all is there,
 * with no wait for one that never comes. Start it before sending what the socket must not get,
 * since an event that arrived before it started isn't kept.
 */
export function hearing(socket: Socket, server: ChatSocket) {
  const events: string[] = []
  const listener = (event: string) => events.push(event)
  socket.onAny(listener)
  return async () => {
    const marked = next(socket, 'test:mark')
    server.emit('test:mark')
    await marked
    socket.offAny(listener)
    return events.filter((event) => event !== 'test:mark')
  }
}

/** The events `socket` gets from now up to a mark, as hearing() keeps them. */
export const heard = (socket: Socket, server: ChatSocket) => hearing(socket, server)()

/**
 * A port nothing listens on now, for a dev entry that must know its port before it listens. It
 * is let go before the entry listens on it, so another process may take it first: start the
 * entry with onFreePort().
 */
export async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

/**
 * Starts something on a port from freePort(), and gives the port and what `start` gave. If
 * another process took the port first, `start` fails with EADDRINUSE, and it starts again on
 * another port, 3 tries in all. Any other failure fails at once.
 */
export async function onFreePort<T>(start: (port: number) => Promise<T>) {
  for (let tries = 1; ; tries++) {
    const port = await freePort()
    try {
      return { port, started: await start(port) }
    } catch (err) {
      if (tries === 3 || !String(err).includes('EADDRINUSE')) throw err
    }
  }
}
