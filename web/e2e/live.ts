// What the live checks make of what AniList does with the app's requests. Every other check
// answers from recordings, so the live checks, which send the app's own requests to the real
// AniList, are the ones to see its API change. A check judges what it saw with these functions,
// which send nothing, so live.test.ts tries them offline: on the recordings, and on answers broken
// on purpose.
//
// While AniList itself is down or busy, nothing can be learnt about the app, so a check skips,
// saying so (verdict). Anything else that keeps the app from using AniList's answer fails it, in
// AniList's own words when it gave some: a query it turns down, an answer the browser keeps from
// the page, a title in another format (answerProblems). A check also needs things of AniList's
// data, such as enough titles for the page to show. When the data lacks one while the API answers
// as the app reads it, the failure says so: then it is the check's rule that has to change, not
// the app.
import type { Answer } from './browser.ts'
import { QUERIES, type Media } from '../src/features/anime/queries.ts'

/** How long a live check waits for AniList to answer a request, before it calls AniList silent. */
export const WAIT_MS = 20_000

/** What a live check saw of one of the app's requests to AniList, from Chrome and from the page. */
export type Seen = {
  /**
   * AniList's answer to the request, as it came over the network: Chrome reports it even when
   * CORS keeps it from the page. Its status, and its body if that was JSON. None if no answer came.
   */
  post?: { status: number; body?: any }
  /** AniList's answer to the request's CORS preflight, if Chrome sent one. */
  preflight?: { status: number }
  /**
   * Why Chrome failed the request, if it did: a CORS error, such as MissingAllowOriginHeader, or a
   * network one, such as net::ERR_NAME_NOT_RESOLVED.
   */
  failure?: string
  /**
   * What the page's own fetch got within WAIT_MS: an answer, with X-RateLimit-Remaining as the
   * page reads it, or an error. None if it was still waiting.
   */
  page?: { status: number; remaining: string | null } | { error: string }
  /** Only after a 5xx: the status of a one-line health query sent to AniList, 0 if none came. */
  health?: number
}

/**
 * What a live check does about a request: nothing (null), skip because AniList itself is down or
 * busy, fail because AniList answered in a way the app can't use, or first send the one-line
 * health query (probe), which tells AniList being down from the app's query tripping it up.
 */
export type Verdict = null | { skip: string } | { fail: string } | { probe: true }

/** The statuses that mean AniList is down, busy or turning this machine away; 0 for no answer. */
const outage = (status: number) => status === 0 || status === 403 || status === 429 || status >= 500

/**
 * Says what a live check should do about the app's `request` (a few words, such as 'first-visit'),
 * from what it saw. Judged on what came over the network, not on the page's status line: a query
 * AniList turns down and a dead connection read the same there.
 */
export function verdict(
  request: string,
  { post, preflight, failure, page, health }: Seen,
): Verdict {
  const asked = `the app's ${request} request`
  // The answer that decides: the request's, or its preflight's when that is all that came.
  const answer = post ?? preflight
  const errors = Array.isArray(post?.body?.errors)
    ? post.body.errors.map((error: any) => error?.message).filter(Boolean)
    : []
  // The answer in a few words, in AniList's own when it gave some.
  const said =
    answer &&
    `HTTP ${answer.status}${post ? '' : ' to its CORS preflight'}${errors.length ? `: ${errors.join('; ')}` : ''}`
  if (answer?.status === 429)
    return {
      skip: `AniList is busy: it turned ${asked} away (${said}), as this machine has sent it too many requests this minute. It's not the app. Run the live checks again in a minute.`,
    }
  if (answer && answer.status >= 500) {
    if (health === undefined) return { probe: true }
    if (!outage(health))
      return {
        fail: `AniList answers a one-line health query (HTTP ${health}), but answered ${asked} with ${said}: something in the app's query now trips AniList up.`,
      }
    return {
      skip: `AniList isn't responding right now (${said}, and ${health ? `HTTP ${health}` : 'no answer'} to a one-line health query). It's not the app.`,
    }
  }
  if (answer?.status === 403)
    return { skip: `AniList refused requests from this machine (${said}). It's not the app.` }
  if (post && (post.status !== 200 || errors.length))
    return {
      fail: `AniList turned ${asked} down (${said}). Its API has changed, or the query asks for something it no longer has.`,
    }
  if (failure?.startsWith('net::'))
    return {
      skip: `AniList can't be reached from this machine (${failure}). Is it offline? It's not the app.`,
    }
  if (!page)
    return {
      skip: `AniList didn't answer ${asked} within ${WAIT_MS / 1000} seconds. It isn't responding right now; it's not the app.`,
    }
  if ('error' in page)
    return {
      fail: post
        ? `AniList answered ${asked} (${said}), but the browser kept its answer from the page (${failure ?? page.error}): AniList's CORS headers no longer let a web page read it.`
        : `AniList's CORS preflight${preflight ? ` (HTTP ${preflight.status})` : ''} no longer lets the page send ${asked} (${failure ?? page.error}).`,
    }
  return null
}

/**
 * What is wrong with X-RateLimit-Remaining as the page reads it: anilist() holds its requests
 * when it reads '0', so it needs the header readable, and a whole number written plainly.
 */
export function limitProblems(page: { remaining: string | null }): string[] {
  return /^(0|[1-9]\d*)$/.test(page.remaining ?? '')
    ? []
    : [
        `X-RateLimit-Remaining reads ${JSON.stringify(page.remaining)} in the page, where anilist() needs a whole number, to hold its requests at '0'`,
      ]
}

/**
 * The lists of titles one of the app's queries asks for, by the name AniList answers each under
 * (the alias of the page it is on, such as trending, or else Page), with the path of every field
 * it asks for of a title, such as title.romaji. It reads each media(...) call as
 * queries.test.ts's selections() does, skipping arguments, and assumes none holds a parenthesis.
 */
export function listsAsked(query: string): Map<string, string[]> {
  const lists = new Map<string, string[]>()
  for (const call of query.matchAll(/\bmedia\s*\([^)]*\)\s*\{/g)) {
    const page = [...query.slice(0, call.index).matchAll(/(?:(\w+)\s*:\s*)?Page\s*\(/g)].at(-1)
    const tokens =
      query
        .slice(call.index + call[0].length)
        .replace(/\([^)]*\)/g, ' ')
        .match(/[{}]|\w+/g) ?? []
    const fields: string[] = []
    const parents: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '}') {
        if (!parents.length) break // the end of this media(...) call
        parents.pop()
      } else if (tokens[i + 1] === '{') parents.push(tokens[i++])
      else fields.push([...parents, tokens[i]].join('.'))
    }
    lists.set(page?.[1] ?? 'Page', fields)
  }
  return lists
}

/**
 * The path of every field a title holds, named as listsAsked() names them. AniList leaves an object
 * null (a finished show's nextAiringEpisode) or a list empty (no main studio) in place of the
 * fields under it, so the path of either stands for them.
 */
const pathsOf = (value: unknown, path = ''): string[] =>
  Array.isArray(value) && value.length
    ? value.flatMap((item) => pathsOf(item, path))
    : value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, child]) =>
          pathsOf(child, path ? `${path}.${key}` : key),
        )
      : [path]

const whole = (value: unknown): value is number => Number.isInteger(value)
const https = (value: unknown) => typeof value === 'string' && value.startsWith('https://')
const nameOrNull = (value: unknown) => value === null || typeof value === 'string'

/**
 * What the app needs of each field it asks AniList for, as the page reads it (format.ts, the
 * cover's accent in deriveAccent(), the pull's genres and rarity). A list's or an object's fields
 * are judged together, under its path. live.test.ts checks that every field the app asks for has
 * a rule here.
 */
const FORMATS: [path: string, needs: string, holds: (value: any) => boolean][] = [
  ['id', 'a whole number above 0', (id) => whole(id) && id > 0],
  ['title.romaji', 'a name', (name) => typeof name === 'string' && name !== ''],
  ['title.english', 'a name or null', nameOrNull],
  ['title.native', 'a name or null', nameOrNull],
  ['coverImage.extraLarge', 'an https URL', https],
  ['coverImage.large', 'an https URL', https],
  [
    'coverImage.color',
    'a #rrggbb colour or null',
    (color) => color === null || (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)),
  ],
  ['bannerImage', 'an https URL or null', (url) => url === null || https(url)],
  [
    'genres',
    'a list of names',
    (genres) => Array.isArray(genres) && genres.every((genre) => typeof genre === 'string'),
  ],
  [
    'averageScore',
    'a whole number from 0 to 100, or null',
    (score) => score === null || (whole(score) && score >= 0 && score <= 100),
  ],
  [
    'format',
    'an upper-case name, such as TV_SHORT, or null',
    (format) => format === null || (typeof format === 'string' && /^[A-Z_]+$/.test(format)),
  ],
  [
    'episodes',
    'a whole number above 0, or null',
    (episodes) => episodes === null || (whole(episodes) && episodes > 0),
  ],
  [
    'season',
    'WINTER, SPRING, SUMMER, FALL or null',
    (season) => season === null || ['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(season),
  ],
  ['seasonYear', 'a whole number or null', (year) => year === null || whole(year)],
  [
    'studios.nodes',
    'a list of studios, each with a name',
    (studios) =>
      Array.isArray(studios) && studios.every((studio) => typeof studio?.name === 'string'),
  ],
  [
    // nextEpisode() in format.ts reads airingAt as Unix seconds: 2001 to 2286.
    'nextAiringEpisode',
    'null, or an episode number above 0 and its airing time in Unix seconds',
    (next) =>
      next === null ||
      (whole(next?.episode) &&
        next.episode > 0 &&
        whole(next?.airingAt) &&
        next.airingAt > 1e9 &&
        next.airingAt < 1e10),
  ],
]

/** Whether `field`, named as listsAsked() names it, is at `path` in a title, or under it. */
const under = (field: string, path: string) => field === path || field.startsWith(`${path}.`)
const shown = (value: unknown) => JSON.stringify(value) ?? 'missing'

/** What is wrong with one title, found at `where`, for an app that asks for `fields` of it. */
function titleProblems(media: any, where: string, fields: string[]): string[] {
  if (media === null || typeof media !== 'object' || Array.isArray(media))
    return [`${where} is ${shown(media)}, where the app needs a title`]
  const found: string[] = []
  const held = [...new Set(pathsOf(media))]
  const missing = fields.filter((field) => !held.some((path) => under(field, path)))
  const extra = held.filter((path) => !fields.some((field) => under(field, path)))
  if (missing.length) found.push(`${where} has no ${missing.join(', ')}, which the app asks for`)
  if (extra.length) found.push(`${where} has ${extra.join(', ')}, which the app doesn't ask for`)
  for (const [path, needs, holds] of FORMATS) {
    const value = path.split('.').reduce((value: any, key) => value?.[key], media)
    if (!holds(value))
      found.push(`${where}.${path} is ${shown(value)}, where the app needs ${needs}`)
  }
  // The app asks AniList to leave these out (SAFE in queries.ts): anyone can be shown any title.
  if (Array.isArray(media.genres) && media.genres.includes('Hentai'))
    found.push(`${where} is in the Hentai genre, which the app's queries ask AniList to leave out`)
  return found
}

// titlesShown() in browser.ts waits for the page to show a first visit's lists, in nine trending
// panels and four in the decade strip, and the live check of a first visit waits for that too.
const SHOWN: Record<string, number> = { trending: 9, era: 4 }

/** A rule AniList's data breaks while its API answers as the app reads it, said to be so. */
const data = (problem: string) =>
  `${problem}. That's AniList's data, not its API or the app: if it lasts, the rule in web/e2e/live.ts has to change.`

/**
 * What is wrong with AniList's answer to one of the app's requests, a line for each problem, as
 * the app reads it. The lists and fields it should hold come from the app's own query for the
 * request (QUERIES in queries.ts), and each title's fields must be in the formats the app reads
 * (see FORMATS), with none twice in a list and none that the app's queries leave out. A first
 * visit's lists must also have as many titles as the page shows, the decade's from that decade,
 * and a search must find `wanted`, the title whose romaji it searched for, if it is given.
 */
export function answerProblems(
  { request, body }: Pick<Answer, 'request' | 'body'>,
  wanted?: Media,
): string[] {
  const query = Object.values(QUERIES).find((query) => query === request.query)
  if (!query)
    return [
      "the request isn't one of the app's queries in queries.ts, so nothing says what its answer should hold",
    ]
  const found: string[] = []
  const { from, to } = request.variables
  for (const [name, fields] of listsAsked(query)) {
    const where = `data.${name}.media`
    const list = body?.data?.[name]?.media
    if (!Array.isArray(list)) {
      found.push(`${where} is ${shown(list)}, where the app needs a list of titles`)
      continue
    }
    list.forEach((media, i) => found.push(...titleProblems(media, `${where}[${i}]`, fields)))
    const ids = list.map((media) => media?.id)
    const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    if (twice.length) found.push(`${where} lists id ${twice.join(', ')} twice`)

    if (list.length < (SHOWN[name] ?? 0))
      found.push(
        data(
          `${where} has ${list.length} titles, fewer than the ${SHOWN[name]} that titlesShown() in browser.ts waits for the page to show`,
        ),
      )
    if (name === 'era' && typeof from === 'number' && typeof to === 'number') {
      // The decade lies between two dates (see ERAS), 19899999 and 20000000 for the 1990s, and a
      // title that starts in December counts toward the next year's winter, so a season year is
      // allowed from the year of one to the year of the other.
      const [first, last] = [Math.floor(from / 10_000), Math.floor(to / 10_000)]
      const dated = list.filter((media) => whole(media?.seasonYear))
      const outside = dated.filter((media) => media.seasonYear < first || media.seasonYear > last)
      // With none of them from the decade, the filter is gone, not a title's dates.
      if (outside.length && outside.length === dated.length)
        found.push(
          `none of ${where}'s titles is from ${first} to ${last}, the decade asked for: AniList no longer applies the decade's dates`,
        )
      else if (outside.length)
        found.push(
          data(
            `${where} has titles from outside ${first} to ${last}, the decade asked for: ${outside.map((media) => `${media.title?.romaji} (${media.seasonYear})`).join(', ')}`,
          ),
        )
    }
    if (wanted && !list.some((media) => media?.id === wanted.id))
      found.push(
        data(
          `searching ${JSON.stringify(request.variables.search)} found ${list.length} titles, but not ${wanted.title.romaji} (id ${wanted.id}), by its own romaji`,
        ),
      )
  }
  return found
}
