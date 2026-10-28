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

// The README's Phase 5 section on the gacha, from its heading to the next of any level.
function gacha() {
  const start = readme.indexOf('\n### The gacha\n')
  assert.ok(start >= 0, 'the README has no "The gacha" section')
  const end = readme.slice(start + 1).search(/\n#+ /)
  return readme.slice(start, end < 0 ? undefined : start + 1 + end)
}

/**
 * The checks `section` names that their files no longer hold, as `file: name`, once it names at
 * least `least`. Each check is named after its file, in the section's own form:
 * `web/e2e/list.e2e.ts` "a cold My List with 12 titles saved asks AniList once", a name that may be
 * the start of the check's.
 */
function missingChecks(section: string, least: number) {
  const named = [...section.matchAll(/`(web\/[\w/.-]+\.ts)` "([^"]+)"/g)]
  assert.ok(named.length >= least, `the section names only ${named.length} checks`)
  const missing = named.filter(([, file, name]) => {
    const code = readFileSync(`${root}${file}`, 'utf8')
    return !code.includes(`test('${name}`) && !code.includes(`test("${name}`)
  })
  return missing.map(([, file, name]) => `${file}: ${name}`)
}

test('each check the README’s Phase 4 section names is in the file it names', () => {
  assert.deepEqual(
    missingChecks(phase4(), 8),
    [],
    'checks the README names that its files no longer hold',
  )
})

// Phase 5's gacha too (the plan's PR 4, commit 8): done-when 2 and the checks behind each claim.
test('each check the README’s gacha section names is in the file it names', () => {
  assert.deepEqual(
    missingChecks(gacha(), 12),
    [],
    'checks the README names that its files no longer hold',
  )
})

// The README's "Byte budgets now" section, from its heading to the next, or nothing if it has none.
function budgetsNow() {
  const start = readme.indexOf('\n## Byte budgets now\n')
  if (start < 0) return ''
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end < 0 ? undefined : end)
}

// The tables' byte budgets are the bundle check's own: BUDGET in privacy.test.ts, read as text, as
// importing it would run its checks. A budget changed in one and not the other fails, so a raise
// is written in both in the same commit. The bytes themselves come from a build, so they are not
// checked here, only that each is written within its budget. The Phase 4 and Phase 5 tables keep
// the figures those phases closed on, as history, and are not held to the budgets any more: Phase
// 5's was, until the raise for the stamps on listed covers.
function budgets() {
  const privacy = readFileSync(`${root}web/src/app/privacy.test.ts`, 'utf8')
  const block = /\nconst BUDGET = \{([^}]*)\}/.exec(privacy)?.[1] ?? ''
  const budget = Object.fromEntries(
    [...block.matchAll(/'([^']+)': ([\d_]+),/g)].map(([, part, bytes]) => [
      part,
      Number(bytes.replaceAll('_', '')),
    ]),
  )
  assert.equal(Object.keys(budget).length, 6, `BUDGET read as ${JSON.stringify(budget)}`)
  return budget
}

// A table's figure, "94,650 of 94,700 B", as its bytes and its budget.
const read = (cell: string) =>
  /^([\d,]+) of ([\d,]+) B$/
    .exec(cell)
    ?.slice(1)
    .map((n) => Number(n.replaceAll(',', '')))

// Each part of the build as the README's tables name it, and as BUDGET does.
const PARTS: Record<string, string> = {
  'The JS every visit loads': 'the JS every visit loads',
  'The CSS': 'the CSS',
  'The JS loaded only when needed (the samples)': 'the JS loaded only when needed',
  "My List's page, a file of its own": 'My List’s page',
  'The mood scoring, a file of its own': 'the mood scoring',
  'Every other file': 'every other file',
}

/**
 * Checks `rows`, each a table row's part and its figure, against BUDGET: each part's budget is the
 * bundle check's, every part is there, and each figure is within its budget.
 */
function holdToBudgets(rows: [part: string, figure: string][]) {
  assert.deepEqual(
    Object.fromEntries(rows.map(([part, figure]) => [PARTS[part] ?? part, read(figure)?.[1]])),
    budgets(),
    'the budgets in the table, against privacy.test.ts',
  )
  assert.deepEqual(
    rows
      .filter(([, figure]) => {
        const [bytes, most] = read(figure) ?? [NaN, NaN]
        return !(bytes <= most)
      })
      .map(([part, figure]) => `${part}: ${figure}`),
    [],
    'figures over their budget, or not written as "N of M B"',
  )
}

// The rows of a Markdown table in `section`, after its heading row and its rule, as their cells.
const rowsOf = (section: string) =>
  section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.split('|').map((cell) => cell.trim()))

test('the byte budgets in the README’s "Byte budgets now" table are the bundle check’s', () => {
  // Each row reads `| <part> | <bytes> of <budget> B |`.
  holdToBudgets(rowsOf(budgetsNow()).map(([, part, now]) => [part, now]))
})

// The README's Phase 5 section, from its heading to the next.
function phase5() {
  const start = readme.indexOf('\n## Phase 5 complete\n')
  assert.ok(start >= 0, 'the README has no "Phase 5 complete" section')
  const end = readme.indexOf('\n## ', start + 1)
  return readme.slice(start, end < 0 ? undefined : end)
}

test('each check the README’s Phase 5 section names is in the file it names', () => {
  assert.deepEqual(
    missingChecks(phase5(), 15),
    [],
    'checks the README names that its files no longer hold',
  )
})
