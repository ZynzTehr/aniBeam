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

const GUARD = fileURLToPath(new URL('testing/no-network.ts', import.meta.url))

/** Starts the server as a host does, with `env` added, and waits for it to listen. */
async function start(t: TestContext, env: Record<string, string> = {}) {
  // Port 0 asks the system for a free port; Fastify logs the address it got.
  // With the fetch guard, as each test file has it, since the server checks sign-in tokens.
  const server = spawn(
    process.execPath,
    ['--import', GUARD, fileURLToPath(new URL('index.ts', import.meta.url))],
    { env: { ...process.env, PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
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

test("the server serves neither the dev entry's demo page nor Socket.IO's browser file, which only that page loads", async (t) => {
  const { address } = await start(t)
  for (const path of ['/demo', '/demo/demo.js', '/demo/demo.css']) {
    const page = await fetch(`${address}${path}`)
    assert.equal(page.status, 404, path)
    assert.deepEqual(await page.json(), { error: 'not-found' }, path)
  }
  // Socket.IO answers this one itself, with 400, as it has no such file to give.
  const file = await fetch(`${address}/socket.io/socket.io.min.js`)
  assert.notEqual(file.status, 200)
  assert.doesNotMatch(file.headers.get('content-type') ?? '', /javascript/)
})

test('in production, the server refuses to start without its settings, and says why', async (t) => {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0', NODE_ENV: 'production' }
  for (const name of ['CORS_ORIGIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_AUTH_EMULATOR_HOST'])
    delete env[name]
  const server = spawn(process.execPath, [fileURLToPath(new URL('index.ts', import.meta.url))], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => server.kill('SIGKILL'))
  let output = ''
  server.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  server.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  const [code] = await once(server, 'exit')
  assert.equal(code, 1, output)
  assert.match(output, /CORS_ORIGIN is missing/)
  assert.match(output, /FIREBASE_PROJECT_ID is missing/)
  assert.doesNotMatch(output, /Server listening/)
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

test("the server lets CORS_ORIGIN's pages read its answers, and outside production the web dev server's when it is unset", async (t) => {
  const origin = async (address: string, page: string) =>
    (await fetch(`${address}/health`, { headers: { origin: page } })).headers.get(
      'access-control-allow-origin',
    )
  const set = await start(t, { CORS_ORIGIN: 'https://ani-beam.vercel.app' })
  assert.equal(
    await origin(set.address, 'https://ani-beam.vercel.app'),
    'https://ani-beam.vercel.app',
  )
  assert.equal(await origin(set.address, 'http://localhost:5173'), null)
  const unset = await start(t)
  assert.equal(await origin(unset.address, 'http://localhost:5173'), 'http://localhost:5173')
  assert.equal(await origin(unset.address, 'https://ani-beam.vercel.app'), null)
})

test("the server refuses the dev entry's sign-in, dev:<name>", async (t) => {
  // No project, as outside production: no token is taken, so none needs Google's keys.
  const { address, output } = await start(t, { DATABASE_URL: db.url, FIREBASE_PROJECT_ID: '' })
  for (const path of ['/me', '/me/handle']) {
    const response = await fetch(`${address}${path}`, {
      method: path === '/me' ? 'GET' : 'POST',
      headers: { authorization: 'Bearer dev:aki', 'content-type': 'application/json' },
      body: path === '/me' ? undefined : JSON.stringify({ handle: 'aki' }),
    })
    assert.equal(response.status, 401, output())
    assert.deepEqual(await response.json(), { error: 'bad-token' })
  }
  const { rows } = await db.pool.query('select count(*)::int as users from users')
  assert.deepEqual(rows, [{ users: 0 }])
})
