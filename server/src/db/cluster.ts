// A throwaway Postgres: a cluster of its own in a temp folder, on 127.0.0.1 at a free port, with
// no Unix socket, for the server's tests. stop() shuts it down and deletes the folder. A run that
// was killed never gets to, so each start first removes the folders such runs left behind.
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Each cluster's folder is named this, then the pid of the process that made it. */
const PREFIX = 'anibeam-pg-'

export interface Cluster {
  /** The address of the cluster's `postgres` database, as the superuser, with its password. */
  url: string
  /** The folder that holds the cluster, deleted by stop(). */
  dir: string
  /**
   * Stops the cluster and deletes its folder. It waits for nothing, so that it finishes even in
   * the test runner's global teardown, which --test-force-exit doesn't wait for.
   */
  stop(): void
}

/**
 * Where to look for initdb and pg_ctl: Homebrew's Postgres 18 first, then Debian's and Ubuntu's
 * folder for it, which isn't on the PATH, then the PATH.
 */
export function postgresDirs() {
  return [
    '/opt/homebrew/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@18/bin',
    '/usr/lib/postgresql/18/bin',
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ]
}

/**
 * The first of `dirs` that holds initdb and pg_ctl of Postgres 18. Another version is passed
 * over, since the tests are for the version the server will run on. Without 18 the tests can't
 * run, and the error names any other version found.
 */
export function findPostgres(dirs = postgresDirs()) {
  const others: string[] = []
  for (const dir of dirs) {
    if (!existsSync(path.join(dir, 'initdb')) || !existsSync(path.join(dir, 'pg_ctl'))) continue
    const version = versionIn(dir)
    if (version?.split('.')[0] === '18') return dir
    others.push(`${version ?? 'of a version initdb did not say'} at ${dir}`)
  }
  const install = 'Install it with: brew install postgresql@18'
  throw new Error(
    others.length > 0
      ? `Found Postgres ${others.join(', ')}, but the server's tests need 18. ${install}`
      : `No Postgres found (initdb and pg_ctl), and the server's tests need one. ${install}`,
  )
}

/** The version of the Postgres in `dir`, as its initdb says it ("initdb (PostgreSQL) 18.6"). */
function versionIn(dir: string) {
  try {
    const said = execFileSync(path.join(dir, 'initdb'), ['--version'], { encoding: 'utf8' })
    return /\(PostgreSQL\) (\d+(?:\.\d+)*)/.exec(said)?.[1]
  } catch {
    return undefined
  }
}

/** Makes a cluster in a new folder under `parent`, starts it, and says where to reach it. */
export async function startCluster({ parent = tmpdir(), dirs = postgresDirs() } = {}) {
  const pgCtl = path.join(findPostgres(dirs), 'pg_ctl')
  removeStaleClusters(parent, pgCtl)
  const dir = mkdtempSync(path.join(parent, `${PREFIX}${process.pid}-`))
  // A run stopped with Ctrl-C or SIGTERM exits without calling stop() (the test runner turns
  // either into an exit), even while it is still starting, so the cluster also goes on the way
  // out. Only kill -9 skips this, and leaves the folder for the next start to remove.
  const atExit = () => {
    try {
      remove(pgCtl, dir)
    } catch {
      // pg_ctl can't stop the Postgres initdb runs for itself, which ends with initdb. The
      // folder is deleted either way, though initdb may still make it again.
    }
  }
  process.once('exit', atExit)
  const stop = () => {
    process.off('exit', atExit)
    remove(pgCtl, dir)
  }
  const data = path.join(dir, 'data')
  const log = path.join(dir, 'postgres.log')
  try {
    // The superuser can run commands as you (COPY ... TO PROGRAM), and any program on this Mac
    // can reach 127.0.0.1, so it gets a password made for this cluster, which only its address
    // carries. initdb reads it from a file readable by you alone, deleted once read.
    const password = randomBytes(24).toString('hex')
    const passwordFile = path.join(dir, 'password')
    writeFileSync(passwordFile, password, { mode: 0o600 })
    await run(path.join(path.dirname(pgCtl), 'initdb'), [
      ...['-D', data, '-U', 'postgres', '-A', 'scram-sha-256', '--pwfile', passwordFile],
      // Under the C locale lower() folds only A to Z, so Ärger and ärger don't clash as handles
      // here; handles will hold only A to Z, a to z, 0 to 9 and _, which every locale folds alike.
      ...['-E', 'UTF8', '--locale=C', '--no-sync', '--no-instructions'],
    ])
    rmSync(passwordFile)
    const port = await freePort()
    // fsync and the rest are off because nothing need survive a crash, which makes each write
    // about as fast as memory.
    await run(pgCtl, [
      ...['start', '-w', '-D', data, '-l', log, '-o'],
      `-p ${port} -k '' -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    ])
    const cluster: Cluster = {
      url: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
      dir,
      stop,
    }
    return cluster
  } catch (err) {
    // Its log says why, and goes with the folder.
    const why = existsSync(log) ? `\n${readFileSync(log, 'utf8')}` : ''
    try {
      stop()
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
