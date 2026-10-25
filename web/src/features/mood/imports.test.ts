import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Moving a slider, or rolling, must cost no request (spec §1), and the sure way is for the scoring
// and the roll to have no way to make one: they import nothing that talks to AniList or keeps its
// answers, only each other and the slider's words. A type, which the build erases, may come from
// anywhere.
const RULED = ['moodMap.ts', 'score.ts', 'scoring.ts', 'roll.ts']
const ALLOWED = ['./moodMap.ts', './moods.ts', ...RULED.map((file) => `./${file}`)]

/** The modules a file's code imports at run time: every import but `import type`. */
const runtimeImports = (code: string) => importsOf(code).map(({ from }) => from)

/** The same, without what it imports only when asked to, by `import()`. */
const staticImports = (code: string) =>
  importsOf(code)
    .filter(({ lazy }) => !lazy)
    .map(({ from }) => from)

type Import = { from: string; lazy: boolean }

function importsOf(code: string): Import[] {
  const statements = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .matchAll(
      /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    )
  return [...statements].flatMap((match): Import[] => {
    if (match[5]) return [{ from: match[5], lazy: false }]
    if (match[6]) return [{ from: match[6], lazy: true }]
    // import type { A } from 'x', or import { type A, type B } from 'x': erased.
    const names = match[3].trim()
    const erased =
      match[2] !== undefined ||
      (/^\{[\s\S]*\}$/.test(names) &&
        names
          .slice(1, -1)
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .every((name) => name.startsWith('type ')))
    return erased ? [] : [{ from: match[4], lazy: false }]
  })
}

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

test('the scoring and the roll import nothing that could ask AniList for anything', () => {
  const wrong = RULED.flatMap((file) =>
    runtimeImports(read(file))
      .filter((from) => !ALLOWED.includes(from))
      .map((from) => `${file} imports ${from}`),
  )
  assert.deepEqual(wrong, [], 'only the mood map, the score, the roll and moods.ts may be imported')
  // What they may import must keep to the same rule.
  assert.deepEqual(runtimeImports(read('moods.ts')), [], 'moods.ts imports at run time')
})

test('the roll does not import the scoring, so Discover’s pull leaves it out of every visit', () => {
  assert.deepEqual(
    runtimeImports(read('roll.ts')).filter((from) => from !== './moods.ts'),
    [],
    'roll.ts imports',
  )
})

// Discover's machine, the app around it and the scoring's loader load on every visit, so a static
// import of the scoring from any of them would put it in the JS every visit loads. They may only
// ask for it by import(), as the loader does (loadScoring.ts), or import its types.
const SCORING = ['score.ts', 'moodMap.ts', 'scoring.ts'].map(
  (file) => new URL(`./${file}`, import.meta.url).href,
)
const EVERY_VISIT = ['PullMachine.tsx', 'loadScoring.ts', '../../app/App.tsx', '../../main.tsx']

test('Discover’s machine and App never import the scoring statically, only by import()', () => {
  const wrong = EVERY_VISIT.flatMap((file) => {
    const at = new URL(`./${file}`, import.meta.url)
    return staticImports(read(file))
      .filter((from) => from.startsWith('.') && SCORING.includes(new URL(from, at).href))
      .map((from) => `${file} imports ${from}`)
  })
  assert.deepEqual(wrong, [], 'the scoring imported statically by code every visit loads')
})

test('the reading finds every way a file can import at run time, and lets types through', () => {
  const code = [
    "import { anilist } from '../../lib/anilist.ts'",
    "import { useQuery } from '@tanstack/react-query'",
    "import * as queries from '../anime/queries.ts'",
    "import Default, { type Media } from '../anime/queries.ts'",
    "export { tagsOf } from '../anime/tags.ts'",
    "import '../../lib/queryClient.ts'",
    "const lazy = () => import('../anime/samples.ts')",
    'import {',
    '  ERAS,',
    "} from '../anime/queries.ts'",
    "import type { Media } from '../anime/queries.ts'",
    "import { type Tag, type Media as M } from '../anime/queries.ts'",
    "// import { anilist } from '../../lib/anilist.ts'",
  ].join('\n')
  assert.deepEqual(runtimeImports(code), [
    '../../lib/anilist.ts',
    '@tanstack/react-query',
    '../anime/queries.ts',
    '../anime/queries.ts',
    '../anime/tags.ts',
    '../../lib/queryClient.ts',
    '../anime/samples.ts',
    '../anime/queries.ts',
  ])
  // Only import() is left out of what a file imports statically.
  assert.deepEqual(
    staticImports(code).filter((from) => from === '../anime/samples.ts'),
    [],
  )
  assert.equal(staticImports(code).length, runtimeImports(code).length - 1)
})
