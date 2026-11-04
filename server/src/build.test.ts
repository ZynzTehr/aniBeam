import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ChatMessage } from './sockets/messages.ts'
import { testDatabase, type TestDatabase } from './testing/database.ts'
import { ask, client, connected, next, onFreePort, ORIGIN, within } from './testing/sockets.ts'

// The built server, as npm run build makes it and npm start runs it. The tests run the source
// with Node's type stripping, which runs each file as written, so a mistake only the build makes
// (tsc refusing a file, or an import it writes out wrong) would get past them. This builds into a
// temp folder of its own, so neither dist/ nor the gate's build step matters.

const SERVER = fileURLToPath(new URL('../', import.meta.url))
const TSC = fileURLToPath(import.meta.resolve('typescript/bin/tsc'))
const GUARD = fileURLToPath(new URL('testing/no-network.ts', import.meta.url))

/** The temp folder: a package.json saying "type": "module", as server's does, and the builds. */
let out: string
/** The production build, from tsconfig.build.json as it is. */
let built: string
/** A build with src/dev, which tsconfig.build.json leaves out, for the dev entry. */
let builtDev: string
let db: TestDatabase

before(
  async () => {
    db = await testDatabase({ template: 'template0' })
    out = mkdtempSync(path.join(tmpdir(), 'anibeam-build-test-'))
    built = path.join(out, 'dist')
    builtDev = path.join(out, 'dist-dev')
    writeFileSync(path.join(out, 'package.json'), '{ "type": "module" }\n')
    // Its packages, and the migrations, where they are to the built files in server/.
    symlinkSync(path.join(SERVER, '../node_modules'), path.join(out, 'node_modules'))
    symlinkSync(path.join(SERVER, 'migrations'), path.join(out, 'migrations'))
    const devConfig = path.join(out, 'tsconfig.dev.json')
    writeFileSync(
      devConfig,
      JSON.stringify({
        extends: path.join(SERVER, 'tsconfig.build.json'),
        exclude: [path.join(SERVER, 'src/**/*.test.ts'), path.join(SERVER, 'src/testing')],
      }),
    )
    const tsc = (config: string, outDir: string) =>
      promisify(execFile)(process.execPath, [TSC, '-p', config, '--outDir', outDir]).catch(
        (err: { stdout?: string }) => {
          throw new Error(`tsc -p ${config} failed:\n${err.stdout}`)
        },
      )
    // A failed build removes the folder itself: the run may end before after() is reached.
    await Promise.all([
      tsc(path.join(SERVER, 'tsconfig.build.json'), built),
      tsc(devConfig, builtDev),
    ]).catch((err: unknown) => {
      rmSync(out, { recursive: true, force: true })
      throw err
    })
    // tsc writes .js files alone, and the dev entry serves the demo page's files from beside it.
    cpSync(path.join(SERVER, 'src/dev/page'), path.join(builtDev, 'dev/page'), { recursive: true })
  },
  { timeout: 60_000 },
)
after(async () => {
  if (out) rmSync(out, { recursive: true, force: true })
  await db?.close()
})

/** Runs a built entry with `env` added, until the test ends, and waits for it to listen. */
async function run(t: TestContext, entry: string, env: Record<string, string>) {
  // A built file, never the source, which Node would run as well, and pass.
  assert.ok(entry.startsWith(out + path.sep) && entry.endsWith('.js'), entry)
  const server = spawn(process.execPath, ['--import', GUARD, entry], {
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  server.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  server.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
  const exited = once(server, 'exit')
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    // SIGTERM, so that the dev entry closes its pool before it exits.
    server.kill('SIGTERM')
    await exited
  })
  const address = await new Promise<string>((resolve, reject) => {
    server.stdout.on('data', () => {
      const found = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
      if (found) resolve(found[1])
    })
    void exited.then(() => reject(new Error(`${entry} exited before it listened:\n${output}`)))
  })
  return { address, output: () => output }
}

test('the built production entry answers /health, has no demo page, and acks a signed-out join', async (t) => {
  // The build has neither the dev entry nor the tests' helpers.
  assert.equal(existsSync(path.join(built, 'index.js')), true)
  assert.equal(existsSync(path.join(built, 'dev')), false)
  assert.equal(existsSync(path.join(built, 'testing')), false)
  const { address, output } = await run(t, path.join(built, 'index.js'), {
    CORS_ORIGIN: ORIGIN,
    DATABASE_URL: db.url,
    FIREBASE_PROJECT_ID: '',
  })
  assert.deepEqual(await (await fetch(`${address}/health`)).json(), { ok: true }, output())
  const demo = await fetch(`${address}/demo`)
  assert.equal(demo.status, 404)
  assert.deepEqual(await demo.json(), { error: 'not-found' })
  const socket = client(t, address)
  await within(connected(socket), 'connected')
  assert.deepEqual(await ask(socket, 'join', { roomKey: 'anime:154587:ep:5' }), { ok: true })
})

test('the built dev entry carries a message from one client to another in under 1 s', async (t) => {
  const {
    port,
    started: { address, output },
  } = await onFreePort((port) =>
    run(t, path.join(builtDev, 'dev/demo.js'), { DATABASE_URL: db.url, PORT: String(port) }),
  )
  assert.equal((await fetch(`${address}/demo`)).status, 200, output())
  const origin = `http://127.0.0.1:${port}`
  const [aki, rei] = await Promise.all(
    ['aki', 'rei'].map(async (name) => {
      const picked = await fetch(`${address}/me/handle`, {
        method: 'POST',
        headers: { authorization: `Bearer dev:${name}`, 'content-type': 'application/json' },
        body: JSON.stringify({ handle: name }),
      })
      assert.equal(picked.status, 201, output())
      const socket = client(t, address, { origin, auth: { token: `dev:${name}` } })
      await within(connected(socket), `${name} connected`)
      assert.deepEqual(await ask(socket, 'join', { roomKey: 'anime:154587:ep:5' }), { ok: true })
      return socket
    }),
  )
  const arrived = next<ChatMessage>(rei, 'message:new')
  const sent = performance.now()
  const answer = await ask(aki, 'message:send', {
    roomKey: 'anime:154587:ep:5',
    body: 'From the build',
    spoiler: false,
  })
  const message = await arrived
  const took = performance.now() - sent
  t.diagnostic(`the built dev entry: rei got it ${took.toFixed(1)} ms after aki sent it`)
  assert.ok(took < 1000, `rei got it after ${took} ms`)
  assert.deepEqual(answer, { ok: true, message })
  assert.equal(message.handle, 'aki')
})
