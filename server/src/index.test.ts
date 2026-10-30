import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { after, before, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { testDatabase, type TestDatabase } from './testing/database.ts'

let db: TestDatabase
before(async () => {
  db = await testDatabase()
})
after(() => db?.close())

/** Starts the server as a host does, with `env` added, and waits for it to listen. */
async function start(t: TestContext, env: Record<string, string> = {}) {
  // Port 0 asks the system for a free port; Fastify logs the address it got.
  const server = spawn(process.execPath, [fileURLToPath(new URL('index.ts', import.meta.url))], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  server.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  t.after(() => server.kill('SIGKILL'))
  const exited = once(server, 'exit')
  const address = await new Promise<string>((resolve, reject) => {
    server.stdout.on('data', () => {
      const found = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
      if (found) resolve(found[1])
    })
    void exited.then(() => reject(new Error(`the server exited before it listened:\n${output}`)))
  })
  return { server, address, exited, output: () => output }
}

test('the server listens, and on SIGTERM closes and exits with 0', async (t) => {
  const { server, address, exited, output } = await start(t)
  const response = await fetch(`${address}/health`)
  assert.deepEqual(await response.json(), { ok: true })
  server.kill('SIGTERM')
  const [code, signal] = await exited
  assert.deepEqual({ code, signal }, { code: 0, signal: null }, output())
})

test('when Postgres drops an idle connection, the server logs it and goes on answering', async (t) => {
  const { server, address, exited, output } = await start(t, { DATABASE_URL: db.url })
  const history = `${address}/rooms/anime:1:all/messages`
  assert.equal((await fetch(history)).status, 200)
  // The server's pool keeps the connection it used, idle. Postgres ending it is what a restart,
  // or a host cutting idle connections, does.
  const { rows } = await db.pool.query(
    `select pg_terminate_backend(pid) as ended from pg_stat_activity
     where datname = current_database() and pid <> pg_backend_pid()
       and backend_type = 'client backend'`,
  )
  assert.deepEqual(rows, [{ ended: true }])
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (output().includes('terminating connection due to administrator command')) resolve()
    }
    server.stdout.on('data', check)
    check()
    void exited.then(() => reject(new Error(`the server exited:\n${output()}`)))
  })
  assert.deepEqual(await (await fetch(`${address}/health`)).json(), { ok: true })
  assert.equal((await fetch(history)).status, 200, output())
  assert.doesNotMatch(output(), /connectionParameters/, 'the log holds the error, not its client')
})
