import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import type { TestEvent } from 'node:test/reporters'
import everyTestReported from './every-test-reported.ts'

const FILE = path.resolve('src/some.test.ts')

/** An event as the runner sends it, for a test at `nesting` in FILE. */
function event(type: 'test:enqueue' | 'test:pass' | 'test:fail', name: string, nesting = 0) {
  return { type, data: { name, nesting, file: FILE } } as unknown as TestEvent
}

/** What the reporter writes for these events, and the exit code it leaves. */
async function report(events: TestEvent[]) {
  const before = process.exitCode
  process.exitCode = undefined
  try {
    let written = ''
    for await (const text of everyTestReported(
      (async function* () {
        yield* events
      })(),
    ))
      written += text
    return { written, exitCode: process.exitCode }
  } finally {
    process.exitCode = before
  }
}

test('a run whose tests all reported, passed, failed or skipped, passes as it is', async () => {
  assert.deepEqual(
    await report([
      // The runner queues the file itself, named by its path, which never reports.
      event('test:enqueue', 'src/some.test.ts'),
      event('test:enqueue', 'one'),
      event('test:enqueue', 'one'),
      event('test:enqueue', 'two'),
      event('test:enqueue', 'a subtest', 1),
      event('test:pass', 'one'),
      event('test:fail', 'one'),
      event('test:pass', 'two'),
    ]),
    { written: '', exitCode: undefined },
  )
})

test('a file that stopped reporting before its queued tests had all reported fails the run, named', async () => {
  const { written, exitCode } = await report([
    event('test:enqueue', 'one'),
    event('test:enqueue', 'two'),
    event('test:enqueue', 'two'),
    event('test:enqueue', 'three'),
    event('test:pass', 'one'),
    event('test:pass', 'two'),
  ])
  assert.equal(exitCode, 1)
  assert.match(written, /src\/some\.test\.ts: 2 of its tests never reported/)
})
