// The fetch guard itself, apart from installing it (no-network.ts does that), so that its test
// can put it in front of a fetch of its own, which sends nothing anywhere.

/** Set on a guarded fetch, so a test can tell the guard is on before it fetches anything. */
export const GUARDED = Symbol.for('anibeam.no-network')

/** The host names of this computer, as a URL writes them. */
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** `realFetch`, refusing every address but this computer's before it is called. */
export function guard(realFetch: typeof fetch): typeof fetch {
  const guarded: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (!LOCAL.has(url.hostname))
      throw new Error(
        `The server's tests reach nothing on the network, but this one fetched ${url.href}`,
      )
    return realFetch(input, init)
  }
  return Object.assign(guarded, { [GUARDED]: true })
}
