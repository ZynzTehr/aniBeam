// Records AniList's answers for the browser checks into e2e/anilist/, one file per request (see
// e2e/recordings.ts). Run it from web/ with `npm run e2e:record` when recordings.test.ts says a
// recording is missing or stale: it records only those, and deletes the ones no check asks for any
// more. `-- --all` records every one again, to bring in AniList's latest titles; names
// (`-- trending search-frieren`) record just those.
//
// AniList allows 30 requests a minute per IP address, and whatever else runs on this machine shares
// them. So it asks one request at a time, at least 6.5 s apart: never more than 10 in a minute, and
// about two minutes for all 20. It writes nothing unless every answer is a 200 with no errors and a
// list of titles for each list asked for (empty for a search that matches nothing), and it prints
// a line for each recording saying what changed in it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import { format, resolveConfig } from 'prettier'
import { titleOf } from '../src/features/anime/format.ts'
import type { Media } from '../src/features/anime/queries.ts'
import type { Recording } from '../e2e/browser.ts'
import { compare, FOLDER, recordings, requests } from '../e2e/recordings.ts'

const GAP_MS = 6_500
const TRIES = 3

/** Ends the run with nothing written. */
function stop(why: string): never {
  console.error(`\nNothing written: ${why}`)
  process.exit(1)
}

let next = 0 // when the next request may go out
/**
 * AniList's answer to `request`, asked GAP_MS after the last request at the earliest, and asked
 * again after a 429, a 5xx or a failed connection, up to 3 tries in all.
 */
async function ask(request: Recording['request']): Promise<Recording> {
  for (let tries = 1; ; tries++) {
    await sleep(Math.max(0, next - Date.now()))
    next = Date.now() + GAP_MS
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
    }).catch((error: Error) => error)
    let why: string
    let wait: number // seconds before the next try, at the least
    if (response instanceof Error) {
      why = `no connection to AniList (${response.message})`
      wait = 60
    } else if (response.status === 429) {
      // Retry-After says how many seconds AniList's timeout has left. Without it, wait the whole
      // minute it lasts.
      const after = Number(response.headers.get('Retry-After') ?? NaN)
      why = 'AniList answered 429'
      wait = Number.isFinite(after) ? after + 1 : 60
    } else if (response.status >= 500) {
      why = `AniList answered ${response.status}`
      wait = 10
    } else {
      // None left this minute: the next request waits it out, as the app does.
      const left = response.headers.get('X-RateLimit-Remaining')
      if (left === '0') next = Date.now() + 61_000
      process.stdout.write(
        ` ${response.status}, ${left} of ${response.headers.get('X-RateLimit-Limit')} left this minute;`,
      )
      return { request, status: response.status, body: await response.json().catch(() => null) }
    }
    if (tries === TRIES) stop(`${why}, ${TRIES} times in a row`)
    next = Math.max(next, Date.now() + wait * 1000)
    process.stdout.write(` ${why}, asking again in ${Math.round((next - Date.now()) / 1000)} s;`)
  }
}

/**
 * Why an answer can't be kept as a recording, or '' when it can: it must be a 200 with no errors
 * and a list of titles for each list asked for, empty for a search that matches nothing.
 */
function unusable({ status, body }: Recording): string {
  if (status !== 200 || body?.errors)
    return `AniList answered ${status}${body?.errors ? ` with errors: ${JSON.stringify(body.errors)}` : ''}`
  const lists = Object.values(body?.data ?? {})
  if (!lists.length || lists.some((list: any) => !Array.isArray(list?.media)))
    return `AniList answered ${status} with no list of titles`
  return ''
}

/** The lists of titles in an answer, by name: data.Page, or a first visit's trending and era. */
const listsOf = ({ body }: Recording): Record<string, Media[]> =>
  Object.fromEntries(
    Object.entries(body?.data ?? {}).map(([name, list]: [string, any]) => [
      name,
      Array.isArray(list?.media) ? list.media : [],
    ]),
  )

/** What changed in a recording, in a line: titles in and out, their order, and fields by name. */
function changes(before: Recording | undefined, after: Recording): string {
  const lists = listsOf(after)
  if (!before)
    return `new, ${Object.values(lists)
      .map((list) => list.length)
      .join(' + ')} titles`
  if (isDeepStrictEqual(before, after)) return 'unchanged'
  const old = listsOf(before)
  const ids = (list: Media[]) => list.map((media) => media.id)
  const some = (list: Media[]) =>
    ` (${list.slice(0, 3).map(titleOf).join('; ')}${list.length > 3 ? '; …' : ''})`
  return Object.entries(lists)
    .map(([name, now]) => {
      const was = old[name] ?? []
      const added = now.filter((media) => !ids(was).includes(media.id))
      const gone = was.filter((media) => !ids(now).includes(media.id))
      const kept = ids(now).filter((id) => ids(was).includes(id))
      const moved =
        ids(was)
          .filter((id) => kept.includes(id))
          .join() !== kept.join()
      const fields = new Map<string, number>()
      for (const media of now) {
        const earlier = was.find((other) => other.id === media.id)
        for (const key of Object.keys(media) as (keyof Media)[])
          if (earlier && !isDeepStrictEqual(media[key], earlier[key]))
            fields.set(key, (fields.get(key) ?? 0) + 1)
      }
      const parts = [
        added.length && `${added.length} new${some(added)}`,
        gone.length && `${gone.length} gone${some(gone)}`,
        moved && 'order changed',
        fields.size && `changed: ${[...fields].map(([key, n]) => `${key} ×${n}`).join(', ')}`,
      ].filter(Boolean)
      return `${name === 'Page' ? '' : `${name}: `}${parts.join('; ') || 'same titles'}`
    })
    .join(' | ')
}

const args = process.argv.slice(2)
const options = args.filter((arg) => arg.startsWith('--'))
const names = args.filter((arg) => !arg.startsWith('--'))
if (options.some((option) => option !== '--all')) stop(`the only option is --all, not ${options}`)
const wanted = await requests()
const saved = recordings()
const unknown = names.filter((name) => !wanted.some((w) => w.name === name))
if (unknown.length)
  stop(`no request is named ${unknown}. The names: ${wanted.map(({ name }) => name).join(', ')}`)
const { missing, stale, unused } = compare(wanted, saved)
const todo = wanted.filter(({ name }) =>
  names.length
    ? names.includes(name)
    : options.includes('--all') || missing.includes(name) || stale.includes(name),
)
console.log(
  `Recording ${todo.length} of ${wanted.length}, and deleting ${unused.length} no check asks for.`,
)

const fresh = new Map<string, Recording>()
for (const { name, request } of todo) {
  process.stdout.write(`${name}:`)
  const recording = await ask(request)
  // Stopping here spares the rest: an answer that can't be kept (a query AniList turns down, say)
  // usually means the next ones can't be either.
  const why = unusable(recording)
  if (why) stop(`${name}: ${why}`)
  console.log(` ${changes(saved.get(name), recording)}`)
  fresh.set(name, recording)
}

mkdirSync(FOLDER, { recursive: true })
for (const name of unused) rmSync(join(FOLDER, `${name}.json`))
let written = 0
for (const [name, recording] of fresh) {
  // Two-space JSON, then prettier, as `npm run format` would leave it: one field per line, so a
  // diff shows each field that changed, and an unchanged answer writes the same bytes.
  const path = join(FOLDER, `${name}.json`)
  const text = await format(JSON.stringify(recording, null, 2), {
    ...(await resolveConfig(path)),
    filepath: path,
  })
  if (existsSync(path) && readFileSync(path, 'utf8') === text) continue
  writeFileSync(path, text)
  written++
}
console.log(`Wrote ${written} and deleted ${unused.length} in ${relative(process.cwd(), FOLDER)}.`)
