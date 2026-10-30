import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { TestEvent } from 'node:test/reporters'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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

test('no test file awaits at its top level after registering a test, so each queues every test as it loads', () => {
  // A test registered after such an await would never be queued: --test-force-exit would end the
  // file once the tests before the await had run, and the reporter couldn't tell (see
  // every-test-reported.ts). An await before the first test is fine. Each statement at the top of
  // each test file, read without the functions inside it, which run later. The server's and
  // shared's tests run with the same reporters, so their files are read too, from web/.
  const web = fileURLToPath(new URL('..', import.meta.url))
  const files = globSync(
    [
      'src/**/*.test.{ts,tsx}',
      'e2e/**/*.{test,e2e}.ts',
      'scripts/**/*.test.ts',
      '../server/src/**/*.test.ts',
      '../shared/src/**/*.test.ts',
    ],
    { cwd: web },
  )
  const atTop = (node: ts.Node, found: (node: ts.Node) => boolean): boolean =>
    found(node) ||
    (!ts.isFunctionLike(node) && ts.forEachChild(node, (child) => atTop(child, found)) === true)
  const registers = (node: ts.Node) =>
    ts.isCallExpression(node) && /^(test|describe|it|suite)\b/.test(node.expression.getText())
  const awaits = (node: ts.Node) =>
    ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier !== undefined)
  const late = files.flatMap((file) => {
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(web, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    let registered = false
    return source.statements.flatMap((statement) => {
      const awaited = registered && atTop(statement, awaits)
      registered ||= atTop(statement, registers)
      const { line } = source.getLineAndCharacterOfPosition(statement.getStart())
      return awaited ? [`${file}:${line + 1}`] : []
    })
  })
  assert.ok(files.length > 20, `found only ${files.length} test files`)
  assert.ok(
    files.some((file) => file.startsWith('../server/')),
    `found no server test files in ${files.length}`,
  )
  assert.deepEqual(late, [], 'top-level awaits after a test is registered')
})
