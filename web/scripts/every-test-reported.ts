// A test reporter, added by npm test and npm run test:browser: it fails the run, naming the file,
// if a test file stopped reporting before each test it had queued had passed, failed or been
// skipped, so that a run that lost results can't pass on fewer tests (see blocking-test-output).
// A file queues its top-level tests as it loads, before it runs any of them, as long as it awaits
// nothing at its top level after its first test: tests it registered after such an await would
// never be queued, and --test-force-exit would end the file without them, unseen. A test holds
// every test file to that (see every-test-reported.test.ts). A file that ends before it reports
// anything, as by process.exit(0), reads as a file with no tests: as under a name pattern.
import path from 'node:path'
import type { TestEvent } from 'node:test/reporters'

export default async function* everyTestReported(source: AsyncIterable<TestEvent>) {
  // Each file's top-level tests queued but not yet reported, by name.
  const waiting = new Map<string, Map<string, number>>()
  for await (const event of source) {
    if (event.type !== 'test:enqueue' && event.type !== 'test:pass' && event.type !== 'test:fail')
      continue
    const { nesting, name, file } = event.data
    // The runner queues each file as a test of its own, named by its path.
    if (nesting !== 0 || !file || path.resolve(name) === file) continue
    const tests = waiting.get(file) ?? new Map<string, number>()
    waiting.set(file, tests)
    tests.set(name, (tests.get(name) ?? 0) + (event.type === 'test:enqueue' ? 1 : -1))
  }
  const short = [...waiting].flatMap(([file, tests]) => {
    const never = [...tests.values()].reduce((sum, count) => sum + Math.max(0, count), 0)
    return never
      ? [`${path.relative(process.cwd(), file)}: ${never} of its tests never reported`]
      : []
  })
  if (short.length) {
    process.exitCode = 1
    yield `\nTest files stopped before all their tests reported, so the run fails:\n${short.map((line) => `  ${line}\n`).join('')}`
  }
}
