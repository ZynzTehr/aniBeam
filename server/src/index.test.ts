import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('the server listens, and on SIGTERM closes and exits with 0', async (t) => {
  // Port 0 asks the system for a free port; Fastify logs the address it got.
  const server = spawn(process.execPath, [fileURLToPath(new URL('index.ts', import.meta.url))], {
    env: { ...process.env, PORT: '0' },
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
  const response = await fetch(`${address}/health`)
  assert.deepEqual(await response.json(), { ok: true })
  server.kill('SIGTERM')
  const [code, signal] = await exited
  assert.deepEqual({ code, signal }, { code: 0, signal: null }, output)
})
