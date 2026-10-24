import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The README tells a reader, and the course's markers, what the app does and which check holds
// each claim. These keep it from drifting from the code in the two ways most likely to go
// unnoticed: wording left over from before a feature came back, and a check renamed or removed
// while the README still names it.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const readme = readFileSync(`${root}README.md`, 'utf8')

test('the README never calls My List Soon, now that its links are back', () => {
  // A sentence at a time: "Chat about it" keeps its Soon tag, and the gallery shows such tags.
  const sentences = readme.split(/(?<=[.!?])\s+|\n+/)
  assert.deepEqual(
    sentences.filter((sentence) => /My List/.test(sentence) && /\bSoon\b/.test(sentence)),
    [],
  )
})

test('each check the README’s Phase 4 section names is in the file it names', () => {
  const start = readme.indexOf('\n## Phase 4 complete\n')
  assert.ok(start >= 0, 'the README has no "Phase 4 complete" section')
  const end = readme.indexOf('\n## ', start + 1)
  const section = readme.slice(start, end < 0 ? undefined : end)
  // Each check is named after its file, in the section's own form: `web/e2e/list.e2e.ts` "a cold
  // My List with 12 titles saved asks AniList once", a name that may be the start of the check's.
  const named = [...section.matchAll(/`(web\/[\w/.-]+\.ts)` "([^"]+)"/g)]
  assert.ok(named.length >= 8, `the section names only ${named.length} checks`)
  const missing = named.filter(([, file, name]) => {
    const code = readFileSync(`${root}${file}`, 'utf8')
    return !code.includes(`test('${name}`) && !code.includes(`test("${name}`)
  })
  assert.deepEqual(
    missing.map(([, file, name]) => `${file}: ${name}`),
    [],
    'checks the README names that its files no longer hold',
  )
})
