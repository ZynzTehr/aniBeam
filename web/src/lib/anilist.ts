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

/** When requests may resume: X-RateLimit-Reset (Unix seconds), or one minute from now if absent. */
export function retryAt(headers: Headers, now: number): number {
  const reset = Number(headers.get('X-RateLimit-Reset'))
  return reset > 0 ? reset * 1000 : now + 60_000
}

// Shared by every request: after a 429, or when no requests remain in this
// minute, wait until the limit resets instead of collecting more 429s.
let pausedUntil = 0

export async function anilist<T>(
  query: string,
  variables: Variables = {},
  signal?: AbortSignal,
): Promise<T> {
  const wait = pausedUntil - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  })
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
