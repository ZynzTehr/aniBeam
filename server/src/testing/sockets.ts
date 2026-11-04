// Socket.IO clients for the server's tests, as a browser's would connect. Each waits on an event
// or an ack, never on a fixed time, which bounds only a failure.
import type { TestContext } from 'node:test'
import type { AddressInfo } from 'node:net'
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client'
import type { buildApp } from '../app.ts'

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
