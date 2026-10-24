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

// The README's Phase 4 section, from its heading to the next.
function phase4() {
  const start = readme.indexOf('\n## Phase 4 complete\n')
  assert.ok(start >= 0, 'the README has no "Phase 4 complete" section')
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end < 0 ? undefined : end)
}

test('each check the README’s Phase 4 section names is in the file it names', () => {
  const section = phase4()
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

// The table's byte budgets are the bundle check's own: BUDGET in privacy.test.ts, read as text, as
// importing it would run its checks. A budget changed in one and not the other fails. The bytes
// themselves come from a build, and the Tab stops and the test totals from a run, so they are not
// checked here: each row names the check that measures its figure.
test('the byte budgets the README’s Phase 4 table gives are the bundle check’s', () => {
  const privacy = readFileSync(`${root}web/src/app/privacy.test.ts`, 'utf8')
  const block = /\nconst BUDGET = \{([^}]*)\}/.exec(privacy)?.[1] ?? ''
  const budget = Object.fromEntries(
    [...block.matchAll(/'([^']+)': ([\d_]+),/g)].map(([, part, bytes]) => [
      part,
      Number(bytes.replaceAll('_', '')),
    ]),
  )
  // Each row reads `| Bytes, <part> | <before> | <bytes> of <budget> B | <checked by> |`.
  const rows = phase4()
    .split('\n')
    .filter((line) => line.startsWith('| Bytes, '))
    .map((line) => line.split('|').map((cell) => cell.trim()))
  const read = (cell: string) =>
    /^([\d,]+) of ([\d,]+) B$/
      .exec(cell)
      ?.slice(1)
      .map((n) => Number(n.replaceAll(',', '')))
  assert.deepEqual(
    Object.fromEntries(rows.map(([, part, , after]) => [part, read(after)?.[1]])),
    {
      'Bytes, the JS every visit loads': budget['the JS every visit loads'],
      'Bytes, the CSS': budget['the CSS'],
      'Bytes, the JS loaded only when needed (the samples)':
        budget['the JS loaded only when needed'],
      "Bytes, My List's page, a file of its own": budget['My List’s page'],
    },
    'the budgets in the table, against privacy.test.ts',
  )
  assert.deepEqual(
    rows
      .filter(([, , , after]) => {
        const [bytes, most] = read(after) ?? [NaN, NaN]
        return !(bytes <= most)
      })
      .map(([, part, , after]) => `${part}: ${after}`),
    [],
    'figures over their budget, or not written as "N of M B"',
  )
})
