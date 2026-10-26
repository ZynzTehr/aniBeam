import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

// Safari on an iPhone mishandles a range input focused from code (WebKit bug 266283), so the mood
// code never focuses a slider: a tap on a track sets its stop without it (see PullMachine). The
// only focus() it calls is the lever's, which takes focus from Reset moods as that hides.
const ALLOWED = ['lever.current?.focus()']

test('the mood code calls focus() on nothing but the lever, never on a slider', () => {
  const folder = new URL('./', import.meta.url)
  const calls = readdirSync(folder)
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
    .flatMap((file) =>
      [
        ...readFileSync(new URL(file, folder), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '')
          .matchAll(/[\w.?[\]()]*\.focus\s*\([^)]*\)/g),
      ].map(([call]) => `${file}: ${call}`),
    )
  assert.deepEqual(
    calls.filter((call) => !ALLOWED.some((allowed) => call.endsWith(`: ${allowed}`))),
    [],
    'focus() called on something that may be a slider',
  )
  assert.ok(
    calls.some((call) => call.startsWith('PullMachine.tsx: ')),
    'the scan found no focus() at all, so it may be reading nothing',
  )
})
