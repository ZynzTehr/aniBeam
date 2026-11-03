// Loaded into each server test file's process before the file runs (npm test's --import): fetch
// refuses every address but this computer's, so that no test reaches Google's key server, or
// anything else on the internet, even by mistake. A test that tries fails, naming the address.
const realFetch = globalThis.fetch

/** Set on the guarded fetch, so a test can tell the guard is on before it fetches anything. */
export const GUARDED = Symbol.for('anibeam.no-network')

/** The host names of this computer, as a URL writes them. */
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

const guarded: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (!LOCAL.has(url.hostname))
    throw new Error(
      `The server's tests reach nothing on the network, but this one fetched ${url.href}`,
    )
  return realFetch(input, init)
}
globalThis.fetch = Object.assign(guarded, { [GUARDED]: true })
