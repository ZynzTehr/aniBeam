// Which IP address a request comes from, for the limits that count per address, such as the
// sockets' connections per IP. With no proxy in front of the server, it is the address of the
// connection itself. Behind a proxy, every connection comes from the proxy, which adds the
// address it got the request from to the end of X-Forwarded-For. A client can write anything
// into that header before it reaches the proxy, so only the entries the trusted proxies added
// are read, from the right (fixed choice 3): the rightmost entry a trusted hop vouches for.
// REST (Fastify's request.ip) and the sockets read the address by this one rule.
import type { IncomingHttpHeaders } from 'node:http'
import { BlockList, isIP } from 'node:net'

/**
 * Which proxies the server trusts (TRUST_PROXY): none (undefined), the one hop in front of it
 * (1), or the proxies at these addresses. Never every hop, which would take the leftmost entry.
 */
export type TrustProxy = undefined | 1 | readonly string[]

/**
 * Whether the address at `hop` is a proxy the server trusts to say who it got the request from.
 * Hop 0 is the connection's own address, hop 1 the rightmost X-Forwarded-For entry, and so on
 * leftward. Fastify's trustProxy option takes this same function.
 */
export type Trusts = (address: string, hop: number) => boolean

/** The check of each hop for `setting`, or undefined when no proxy is trusted. */
export function proxyTrust(setting: TrustProxy): Trusts | undefined {
  if (setting === undefined) return undefined
  if (setting === 1) return (_address, hop) => hop === 0
  const proxies = new BlockList()
  for (const address of setting) proxies.addAddress(address, family(address))
  // An entry that isn't an address is no proxy. BlockList matches an IPv4 proxy written as
  // IPv6 too (::ffff:10.0.0.2), as a server listening on :: sees IPv4 connections.
  return (address) => isIP(address) !== 0 && proxies.check(address, family(address))
}

/** The address family BlockList asks for. */
const family = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4')

/**
 * The address `request` comes from, by `trusts` (proxyTrust): from the connection leftward
 * through X-Forwarded-For, the first hop that isn't a trusted proxy, or the leftmost entry if
 * every hop is. With no trust, the connection's own address, and the header is never read. The
 * header is read as Fastify's request.ip reads it, so that the two always agree: entries split
 * at commas, spaces and tabs around each dropped, and empty entries skipped.
 */
export function clientIp(
  request: { socket: { remoteAddress?: string }; headers: IncomingHttpHeaders },
  trusts: Trusts | undefined,
) {
  const connection = request.socket.remoteAddress
  if (trusts === undefined) return connection
  const header = request.headers['x-forwarded-for']
  const entries =
    typeof header !== 'string'
      ? []
      : !header.includes(',')
        ? [header.trim()]
        : header.split(',').map((entry) => entry.replace(/^[ \t]+|[ \t]+$/g, ''))
  const hops = [connection, ...entries.filter((entry) => entry !== '').reverse()]
  for (let hop = 0; hop < hops.length - 1; hop++)
    if (!trusts(hops[hop] ?? '', hop)) return hops[hop]
  return hops.at(-1)
}
