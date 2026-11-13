// A rate limit on a sliding window: at most `limit` tries by one key in any `windowMs` ms, such
// as 5 messages by one user in any 10 s. A fixed window, counting from 0 again every 10 s, would
// let 5 through just before its end and 5 more just after, 10 in a moment. Here each try leaves
// the window `windowMs` after it was made, so the 6th waits for the oldest to leave. The clock
// is passed in, so that tests move it by hand, and the limits live in memory, so a restart
// forgets them, which is fine for one server.

export interface RateLimit {
  /**
   * Counts a try by `key` now, if the window has room for it. Gives undefined when it does, and
   * otherwise the ms until the oldest try in the window leaves it, when the next may come. A
   * refused try isn't counted.
   */
  take(key: string): number | undefined
  /** How many keys it keeps now, for the tests. */
  readonly size: number
}

/** A sliding-window limit of `limit` tries per key in `windowMs` ms, by the clock `now`. */
export function rateLimit({
  limit,
  windowMs,
  now,
}: {
  limit: number
  windowMs: number
  now: () => number
}): RateLimit {
  /** Each key's tries in the window, oldest first, at most `limit` of them. */
  const tries = new Map<string, number[]>()
  let swept = now()
  return {
    take(key) {
      const at = now()
      // Once a window, the keys whose tries have all left it go, so that the map holds only the
      // keys that tried within the last two windows, however many tried before.
      if (at - swept >= windowMs) {
        for (const [other, times] of tries)
          if (at - (times.at(-1) ?? -Infinity) >= windowMs) tries.delete(other)
        swept = at
      }
      const times = tries.get(key) ?? []
      // A try made windowMs ago or more has left the window.
      while (times.length > 0 && at - times[0] >= windowMs) times.shift()
      // Rounded up, since the app's clock has fractions of a ms: rounded down, a try just before
      // the oldest leaves could be told to wait 0 ms, and be refused again when it came back.
      if (times.length >= limit) return Math.ceil(times[0] + windowMs - at)
      times.push(at)
      tries.set(key, times)
      return undefined
    },
    get size() {
      return tries.size
    },
  }
}
