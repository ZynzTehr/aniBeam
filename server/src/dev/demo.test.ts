import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { connect, createServer, type AddressInfo } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { testDatabase, type TestDatabase } from '../testing/database.ts'
import { client, connected, within } from '../testing/sockets.ts'

let db: TestDatabase
before(async () => {
  // An empty database, as a new DATABASE_URL's starts: the dev entry makes the tables.
  db = await testDatabase({ template: 'template0' })
})
after(() => db?.close())

/**
 * Runs the dev entry with `env` added, collecting what it prints: its file, or with `npm`, npm
 * run demo:chat in a process group of its own, as a terminal runs it, so that a signal sent to
 * the group reaches npm and the entry both, as Ctrl-C does.
 */
function demo(t: TestContext, env: Record<string, string>, { npm = false } = {}) {
  const child = npm
    ? spawn('npm', ['run', '--silent', 'demo:chat'], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, PORT: '0', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
    : spawn(process.execPath, [fileURLToPath(new URL('demo.ts', import.meta.url))], {
        env: { ...process.env, PORT: '0', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
  /** Sends `signal` to the entry, and with npm to its whole group. */
  const signal = (name: NodeJS.Signals) => process.kill(npm ? -child.pid! : child.pid!, name)
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  const exited = once(child, 'exit')
  // SIGTERM, not SIGKILL, so that a dev entry still running stops its Postgres.
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    signal('SIGTERM')
    await exited
  })
  const listening = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', () => {
      const found = /Server listening at (http:\/\/[^"\s]+)/.exec(output)
      if (found) resolve(found[1])
    })
    void exited.then(() => reject(new Error(`the dev entry exited before it listened:\n${output}`)))
  })
  // Seen only by a test that awaits it.
  listening.catch(() => {})
  return { signal, exited, listening, output: () => output }
}

test('the dev entry refuses to start with NODE_ENV=production', async (t) => {
  const { exited, output } = demo(t, { NODE_ENV: 'production', DATABASE_URL: db.url })
  const [code] = await exited
  assert.equal(code, 1, output())
  assert.match(output(), /refuses to start with NODE_ENV=production/)
  assert.doesNotMatch(output(), /Server listening/)
})

test('with DATABASE_URL, the dev entry makes its tables and listens on 127.0.0.1 only', async (t) => {
  const { signal: send, exited, listening, output } = demo(t, { DATABASE_URL: db.url })
  const address = await listening
  assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.deepEqual(await (await fetch(`${address}/health`)).json(), { ok: true })
  const history = await fetch(`${address}/rooms/anime:154587:ep:5/messages`)
  assert.deepEqual(await history.json(), { messages: [], nextBefore: null })
  // This computer's other addresses, such as its Wi-Fi one, reach nothing on that port.
  const { port } = new URL(address)
  const others = Object.values(networkInterfaces())
    .flatMap((nets) => nets ?? [])
    .filter((net) => !net.internal && net.family === 'IPv4')
  for (const { address: other } of others) {
    const [err] = (await once(connect(Number(port), other), 'error')) as [NodeJS.ErrnoException]
    assert.equal(err.code, 'ECONNREFUSED', other)
  }
  send('SIGTERM')
  const [code, signal] = await exited
  assert.deepEqual({ code, signal }, { code: 0, signal: null }, output())
})

test('without DATABASE_URL, it starts a throwaway Postgres, and Ctrl-C deletes it', async (t) => {
  // TMPDIR is where the cluster's folder goes, so this sees only the dev entry's own.
  const parent = mkdtempSync(path.join(tmpdir(), 'anibeam-demo-test-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const {
    signal: send,
    exited,
    listening,
    output,
  } = demo(t, { DATABASE_URL: '', TMPDIR: parent }, { npm: true })
  const address = await listening
  // npm keeps a cache of its own there too.
  const clusters = () => readdirSync(parent).filter((name) => name.startsWith('anibeam-pg-'))
  assert.equal(clusters().length, 1)
  const history = await fetch(`${address}/rooms/anime:1:all/messages`)
  assert.equal(history.status, 200, output())
  // Ctrl-C: the entry gets SIGINT from the terminal, and again from npm passing it on. npm waits
  // for it, and exits as it does.
  send('SIGINT')
  const [code, signal] = await exited
  assert.deepEqual({ code, signal }, { code: 0, signal: null }, output())
  assert.deepEqual(clusters(), [], 'the throwaway Postgres is deleted')
})

test('closing the terminal (SIGHUP) stops it too, and deletes the throwaway Postgres', async (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), 'anibeam-demo-test-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const { signal: send, exited, listening, output } = demo(t, { DATABASE_URL: '', TMPDIR: parent })
  await listening
  const clusters = () => readdirSync(parent).filter((name) => name.startsWith('anibeam-pg-'))
  assert.equal(clusters().length, 1)
  // A terminal sends SIGHUP to what runs in it as it closes. Postgres, which pg_ctl started apart
  // from the terminal, gets none, so only the entry can stop it.
  send('SIGHUP')
  const [code, signal] = await exited
  assert.deepEqual({ code, signal }, { code: 0, signal: null }, output())
  assert.deepEqual(clusters(), [], 'the throwaway Postgres is deleted')
})

/** A port nothing listens on now, for a dev entry that must know its port before it listens. */
async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

test("the dev entry's own pages open sockets, and load Socket.IO's browser file", async (t) => {
  const port = await freePort()
  const { listening, output } = demo(t, { DATABASE_URL: db.url, PORT: String(port) })
  const address = await listening
  const file = await fetch(`${address}/socket.io/socket.io.min.js`)
  assert.equal(file.status, 200, output())
  assert.match(file.headers.get('content-type') ?? '', /javascript/)
  for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
    await within(connected(client(t, address, { origin })), origin)
  // Any other page, the web dev server's too, is refused.
  for (const origin of [
    'http://localhost:5173',
    'https://evil.example',
    `http://127.0.0.1:${port + 1}`,
  ])
    await assert.rejects(within(connected(client(t, address, { origin })), origin), origin)
})
