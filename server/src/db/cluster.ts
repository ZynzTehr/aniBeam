// A throwaway Postgres: a cluster of its own in a temp folder, on 127.0.0.1 at a free port, with
// no Unix socket, for the server's tests. stop() shuts it down and deletes the folder. A run that
// was killed never gets to, so each start first removes the folders such runs left behind.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Each cluster's folder is named this, then the pid of the process that made it. */
const PREFIX = 'anibeam-pg-'

export interface Cluster {
  /** The address of the cluster's `postgres` database, as the superuser `postgres`. */
  url: string
  /** The folder that holds the cluster, deleted by stop(). */
  dir: string
  /**
   * Stops the cluster and deletes its folder. It waits for nothing, so that it finishes even in
   * the test runner's global teardown, which --test-force-exit doesn't wait for.
   */
  stop(): void
}

/** Where to look for initdb and pg_ctl: Homebrew's Postgres 18 first, then the PATH. */
export function postgresDirs() {
  return [
    '/opt/homebrew/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@18/bin',
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ]
}

/** The first of `dirs` that holds both initdb and pg_ctl. Without one the tests can't run. */
export function findPostgres(dirs = postgresDirs()) {
  const found = dirs.find(
    (dir) => existsSync(path.join(dir, 'initdb')) && existsSync(path.join(dir, 'pg_ctl')),
  )
  if (!found)
    throw new Error(
      "No Postgres found (initdb and pg_ctl), and the server's tests need one. " +
        'Install it with: brew install postgresql@18',
    )
  return found
}

/** Makes a cluster in a new folder under `parent`, starts it, and says where to reach it. */
export async function startCluster({ parent = tmpdir(), dirs = postgresDirs() } = {}) {
  const pgCtl = path.join(findPostgres(dirs), 'pg_ctl')
  removeStaleClusters(parent, pgCtl)
  const dir = mkdtempSync(path.join(parent, `${PREFIX}${process.pid}-`))
  const data = path.join(dir, 'data')
  const log = path.join(dir, 'postgres.log')
  try {
    // trust lets anyone on this Mac connect without a password: there is nothing to protect, and
    // only 127.0.0.1 is listened on. fsync and the rest are off because nothing need survive a
    // crash, which makes each write about as fast as memory.
    await run(path.join(path.dirname(pgCtl), 'initdb'), [
      ...['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'],
      ...['--no-sync', '--no-instructions'],
    ])
    const port = await freePort()
    await run(pgCtl, [
      ...['start', '-w', '-D', data, '-l', log, '-o'],
      `-p ${port} -k '' -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    ])
    const cluster: Cluster = {
      url: `postgres://postgres@127.0.0.1:${port}/postgres`,
      dir,
      stop: () => remove(pgCtl, dir),
    }
    return cluster
  } catch (err) {
    // Its log says why, and goes with the folder.
    const why = existsSync(log) ? `\n${readFileSync(log, 'utf8')}` : ''
    try {
      remove(pgCtl, dir)
    } catch {
      // The folder is gone either way.
    }
    throw new Error(`The throwaway Postgres didn't start: ${(err as Error).message}${why}`, {
      cause: err,
    })
  }
}

/**
 * Removes the cluster folders under `parent` whose maker is no longer running, stopping any
 * Postgres still running in them first, and returns the folders it removed. A folder whose maker
 * still runs is another run's, and is left alone.
 */
export function removeStaleClusters(
  parent = tmpdir(),
  pgCtl = path.join(findPostgres(), 'pg_ctl'),
) {
  const stale = readdirSync(parent)
    .filter(
      (name) =>
        name.startsWith(PREFIX) && !running(Number(name.slice(PREFIX.length).split('-')[0])),
    )
    .map((name) => path.join(parent, name))
  for (const dir of stale)
    try {
      remove(pgCtl, dir)
    } catch {
      // Its Postgres had stopped already; the folder is gone either way.
    }
  return stale
}

/** Stops the Postgres running in a cluster's folder, if one is, and deletes the folder. */
function remove(pgCtl: string, dir: string) {
  const data = path.join(dir, 'data')
  try {
    // immediate: nothing in it is kept, so there is nothing to write out first.
    if (existsSync(path.join(data, 'postmaster.pid')))
      execFileSync(pgCtl, ['stop', '-w', '-D', data, '-m', 'immediate'], { stdio: 'pipe' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Whether a process with this pid is running. */
function running(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it runs, as another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A port on 127.0.0.1 that nothing listens on, from the system. */
async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}
