// Minimal AniList GraphQL client. Requests go straight from the browser, so each
// visitor's IP has its own rate limit (currently 30 requests/minute).

const ENDPOINT = 'https://graphql.anilist.co'

export type Variables = Record<string, string | number>

export class AniListError extends Error {
  status: number
  /** For 429 responses: when requests may resume (ms since epoch). */
  retryAt?: number

  constructor(message: string, status: number, retryAt?: number) {
    super(message)
    this.name = 'AniListError'
    this.status = status
    this.retryAt = retryAt
  }
}

/**
 * When requests may resume. AniList's timeout lasts one minute, so X-RateLimit-Reset
 * (Unix seconds, from AniList's clock) is trusted only if it falls within the next
 * minute on this computer's clock. Otherwise the header is missing or the two clocks
 * disagree, and waiting the full minute is always enough.
 */
export function retryAt(headers: Headers, now: number): number {
  const reset = Number(headers.get('X-RateLimit-Reset')) * 1000
  return reset > now && reset <= now + 60_000 ? reset : now + 60_000
}

// Shared by every request: after a 429, a failed connection, or when no requests
// remain in this minute, wait until the limit resets instead of collecting more 429s.
let pausedUntil = 0

export async function anilist<T>(
  query: string,
  variables: Variables = {},
  signal?: AbortSignal,
): Promise<T> {
  // Check again after every wait: a response that arrived meanwhile may have extended the pause.
  while (pausedUntil > Date.now()) {
    await new Promise((resolve) => setTimeout(resolve, pausedUntil - Date.now()))
  }

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    })
  } catch (error) {
    // AniList's burst limiter can answer 429 without CORS headers, which the browser
    // reports only as a failed connection, so wait the full minute in case it was one.
    // A request we cancelled ourselves pauses nothing.
    if (!signal?.aborted) pausedUntil = Date.now() + 60_000
    throw error
  }
  if (res.status === 429 || res.headers.get('X-RateLimit-Remaining') === '0') {
    pausedUntil = retryAt(res.headers, Date.now())
  }

  // AniList reports errors in the JSON body, sometimes with HTTP 200.
  const body = (await res.json().catch(() => null)) as {
    data?: T | null
    errors?: { message: string; status?: number }[]
  } | null
  const error = body?.errors?.[0]
  if (error || !res.ok || !body?.data) {
    throw new AniListError(
      error?.message ?? `AniList request failed (HTTP ${res.status})`,
      error?.status ?? res.status,
      res.status === 429 ? pausedUntil : undefined,
    )
  }
  return body.data
}
