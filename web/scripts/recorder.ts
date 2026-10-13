// The recorder's work, which scripts/record-anilist.ts runs (`npm run e2e:record`; what it does and
// why is said there). It reaches AniList, the clock, the folder and the terminal only through the
// World it is handed, so that recorder.test.ts can run it on stand-ins: an AniList that answers as
// a test needs, a clock that moves only when the recorder waits, and a folder of its own. Its
// manners towards AniList are then tried with no request sent and no time spent.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as timers from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import { format, resolveConfig } from 'prettier'
import { titleOf } from '../src/features/anime/format.ts'
import type { Media } from '../src/features/anime/queries.ts'
import type { Recording } from '../e2e/browser.ts'
import { compare, FOLDER, listsOf, problems, recordings, requests } from '../e2e/recordings.ts'

const GAP_MS = 6_500
const TRIES = 3

/**
 * What a run reaches outside itself through: the real ones, from realWorld(), when
 * record-anilist.ts runs it, and stand-ins when recorder.test.ts does.
 */
export type World = {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<unknown>
  /** The time, in milliseconds. */
  now: () => number
  /** Where the recordings are kept. */
  folder: string
  /** Where it says what it does, and where it says why it stopped. */
  stdout: { write: (text: string) => unknown }
  stderr: { write: (text: string) => unknown }
}

/**
 * The real World, which record-anilist.ts hands record(): fetch, a sleep from
 * node:timers/promises, Date.now, e2e/anilist/, and process.stdout and stderr. It is put together
 * here, not in the script, so that recorder.test.ts can check it: a slip in it, such as a sleep
 * that waits 6.5 ms where the recorder asks for 6,500, would pass every other check and send
 * AniList's requests back to back. A function, not a constant, so that it takes the global fetch
 * as it is when called: recorder.test.ts swaps that for one that refuses while record() runs on
 * stand-ins, so a run that reached for the real World would be refused, not sent to AniList.
 */
export function realWorld(): World {
  return {
    fetch,
    sleep: timers.setTimeout,
    now: () => Date.now(),
    folder: FOLDER,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

/** Why a run stopped, on its way out to record(), which says so. */
class Stopped extends Error {}

/** Ends the run with nothing written. */
function stop(why: string): never {
  throw new Stopped(why)
}

/**
 * Records AniList's answers as `args` (the script's arguments) asks: the missing and stale
 * recordings, every one with --all, or the ones named. Resolves to the exit code: 0, or 1 once it
 * has said why it stopped, with nothing written.
 */
export async function record(args: string[], world: World): Promise<number> {
  try {
    await run(args, world)
    return 0
  } catch (error) {
    if (!(error instanceof Stopped)) throw error
    world.stderr.write(`\nNothing written: ${error.message}\n`)
    return 1
  }
}

/** How a run asks AniList: one request at a time, with what it needs to know to wait its turn. */
function asker({ fetch, sleep, now, stdout }: World) {
  let next = 0 // when the next request may go out
  /**
   * AniList's answer to `request`, asked GAP_MS after the last request at the earliest, and asked
   * again after a 429, a 5xx or a failed connection, up to 3 tries in all.
   */
  return async function ask(request: Recording['request']): Promise<Recording> {
    for (let tries = 1; ; tries++) {
      await sleep(Math.max(0, next - now()))
      next = now() + GAP_MS
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
        if (left === '0') next = now() + 61_000
        stdout.write(
          ` ${response.status}, ${left} of ${response.headers.get('X-RateLimit-Limit')} left this minute;`,
        )
        return { request, status: response.status, body: await response.json().catch(() => null) }
      }
      if (tries === TRIES) stop(`${why}, ${TRIES} times in a row`)
      next = Math.max(next, now() + wait * 1000)
      stdout.write(` ${why}, asking again in ${Math.round((next - now()) / 1000)} s;`)
    }
  }
}

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

/** What record() does, ending at stop() when it can't go on. */
async function run(args: string[], world: World) {
  const { folder, stdout } = world
  const options = args.filter((arg) => arg.startsWith('--'))
  const names = args.filter((arg) => !arg.startsWith('--'))
  if (options.some((option) => option !== '--all')) stop(`the only option is --all, not ${options}`)
  const wanted = await requests()
  const saved = recordings(folder)
  const unknown = names.filter((name) => !wanted.some((w) => w.name === name))
  if (unknown.length)
    stop(`no request is named ${unknown}. The names: ${wanted.map(({ name }) => name).join(', ')}`)
  const { missing, stale, unused } = compare(wanted, saved)
  const todo = wanted.filter(({ name }) =>
    names.length
      ? names.includes(name)
      : options.includes('--all') || missing.includes(name) || stale.includes(name),
  )
  stdout.write(
    `Recording ${todo.length} of ${wanted.length}, and deleting ${unused.length} no check asks for.\n`,
  )

  const ask = asker(world)
  const fresh = new Map<string, Recording>()
  for (const { name, request } of todo) {
    stdout.write(`${name}:`)
    const recording = await ask(request)
    // Stopping here spares the rest: an answer that can't be kept (a query AniList turns down, say)
    // usually means the next ones can't be either. Judged on its own: a rule that compares it with
    // another recording waits for the end, when every answer is in.
    const why = problems(new Map([[name, recording]])).join('\n')
    if (why) stop(why)
    stdout.write(` ${changes(saved.get(name), recording)}\n`)
    fresh.set(name, recording)
  }

  // The folder as it would be: what it holds, with the new answers in and the unused gone. Saved
  // recordings count too, as the checks would get them all.
  const after = new Map([...saved, ...fresh])
  for (const name of unused) after.delete(name)
  const found = problems(after)
  if (found.length)
    stop(`these recordings would lack what the checks rely on:\n${found.join('\n')}`)

  mkdirSync(folder, { recursive: true })
  for (const name of unused) rmSync(join(folder, `${name}.json`))
  let written = 0
  for (const [name, recording] of fresh) {
    // Two-space JSON, then prettier, as `npm run format` would leave it: one field per line, so a
    // diff shows each field that changed, and an unchanged answer writes the same bytes.
    const path = join(folder, `${name}.json`)
    const text = await format(JSON.stringify(recording, null, 2), {
      ...(await resolveConfig(path)),
      filepath: path,
    })
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue
    writeFileSync(path, text)
    written++
  }
  stdout.write(
    `Wrote ${written} and deleted ${unused.length} in ${relative(process.cwd(), folder)}.\n`,
  )
}
