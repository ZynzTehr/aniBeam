import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { removeStaleClusters, startCluster } from './cluster.ts'

/** Whether a process with this pid is running. */
function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pid of a cluster's Postgres, the first line of its postmaster.pid. */
function postmasterPid(file: string) {
  return Number(readFileSync(file, 'utf8').split('\n')[0])
}

test("no initdb fails the run with 'brew install postgresql@18'", async () => {
  // npm test's global setup awaits startCluster, so this is what fails the run.
  await assert.rejects(startCluster({ dirs: [] }), /brew install postgresql@18/)
})

test('a folder a killed run left is removed with its Postgres stopped, and a running run keeps its own', async (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), 'anibeam-stale-'))
  // A run killed with its cluster up: a process starts one, then dies without stopping it.
  const killed = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const { startCluster } = await import(${JSON.stringify(import.meta.resolve('./cluster.ts'))})
      await startCluster({ parent: ${JSON.stringify(parent)} })
      console.log('started')
      setInterval(() => {}, 1000)`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  // Whatever happens below, nothing of this test is left running.
  t.after(async () => {
    if (killed.exitCode === null && killed.signalCode === null) {
      killed.kill('SIGKILL')
      await once(killed, 'exit')
    }
    // Its Postgres is stopped here without removeStaleClusters, which may be what failed.
    for (const name of readdirSync(parent)) {
      const pidFile = path.join(parent, name, 'data', 'postmaster.pid')
      if (existsSync(pidFile) && running(postmasterPid(pidFile)))
        process.kill(postmasterPid(pidFile), 'SIGQUIT')
    }
    rmSync(parent, { recursive: true, force: true })
  })
  const [started] = await once(killed.stdout, 'data')
  assert.equal(String(started).trim(), 'started')
  killed.kill('SIGKILL')
  await once(killed, 'exit')
  const [left] = readdirSync(parent)
  const postgres = postmasterPid(path.join(parent, left, 'data', 'postmaster.pid'))
  assert.ok(running(postgres), 'the killed run left its Postgres running')
  // A folder whose maker still runs belongs to another run: this one.
  const kept = `anibeam-pg-${process.pid}-kept`
  mkdirSync(path.join(parent, kept))

  assert.deepEqual(removeStaleClusters(parent), [path.join(parent, left)])
  assert.deepEqual(readdirSync(parent), [kept])
  // Postgres's own parent is gone, so it may take a moment to be reaped.
  for (let tries = 0; running(postgres) && tries < 50; tries++) await sleep(20)
  assert.equal(running(postgres), false, 'its Postgres was stopped')
})
