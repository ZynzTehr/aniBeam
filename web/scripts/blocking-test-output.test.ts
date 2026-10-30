import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('..', import.meta.url))

test('a process ended the moment it has written still hands all of it over through its pipe', async () => {
  // As --test-force-exit ends a test file's process: 4 MB written, then process.exit(). Through a
  // pipe, on macOS, only the first 64 KB arrived (the pipe's buffer), every time, unless the
  // process loads blocking-test-output.ts.
  const child = spawn(
    process.execPath,
    [
      '--import',
      './scripts/blocking-test-output.ts',
      '-e',
      "process.stdout.write('x'.repeat(4_000_000)); process.exit(0)",
    ],
    { cwd: WEB, stdio: ['ignore', 'pipe', 'inherit'] },
  )
  let received = 0
  child.stdout.on('data', (chunk: Buffer) => (received += chunk.length))
  await new Promise((resolve) => child.on('close', resolve))
  assert.equal(received, 4_000_000)
})

test('both test commands load blocking-test-output.ts into each test process and fail on lost results', () => {
  // The two halves of what keeps a run from passing on fewer tests (see the two scripts): each
  // alone leaves a hole, and in a run that loses nothing, dropping either changes nothing to see.
  const { scripts } = JSON.parse(readFileSync(`${WEB}/package.json`, 'utf8'))
  const missing = ['test', 'test:browser'].flatMap((name) =>
    [
      '--import ./scripts/blocking-test-output.ts --test ',
      '--test-force-exit',
      '--test-reporter=spec --test-reporter-destination=stdout',
      '--test-reporter=./scripts/every-test-reported.ts --test-reporter-destination=stderr',
    ]
      .filter((part) => !String(scripts[name]).includes(part))
      .map((part) => `${name}: ${part}`),
  )
  assert.deepEqual(missing, [], 'what the test commands lack')
})

test('npm run test:browser runs every browser test file', () => {
  // every-test-reported.ts sees only the files that started, and the gate prints the count without
  // a number to hold it to, so a file pattern that left a file out would pass on fewer tests.
  const { scripts } = JSON.parse(readFileSync(`${WEB}/package.json`, 'utf8'))
  const words = String(scripts['test:browser']).split(/\s+/)
  const patterns = words.slice(words.findLastIndex((word) => word.startsWith('--')) + 1)
  const run = new Set(patterns.flatMap((pattern) => globSync(pattern, { cwd: WEB })))
  const left = globSync('e2e/**/*.e2e.ts', { cwd: WEB }).filter((file) => !run.has(file))
  assert.deepEqual(left, [], 'the browser test files npm run test:browser leaves out')
})
