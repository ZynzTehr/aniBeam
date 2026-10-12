import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// TanStack's packages pin query-core, directly or through each other, at their own version
// exactly: react-query 5.104.1 needs query-core 5.104.1, and the async persister 5.104.2 needs
// 5.104.2. So a TanStack package a version apart from the rest brings a second query-core, which
// npm nests under it, and the app then runs code from both copies, each with its own timers and
// state. Vercel installs what this lockfile says, so the lockfile shows a second copy before it
// ships.
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const lockfile = read('../../../package-lock.json')

// Each TanStack package the lockfile installs. npm puts each in node_modules/@tanstack/, or, when
// a package needs a version other than the one there, in that package's own node_modules.
const tanstack = Object.entries<{ version: string }>(lockfile.packages).flatMap(
  ([folder, { version }]) => {
    const name = /(?:^|\/)node_modules\/(@tanstack\/[^/]+)$/.exec(folder)?.[1]
    return name ? [{ folder, name, version }] : []
  },
)
const listed = (entries: typeof tanstack) =>
  entries.map(({ folder, version }) => `${folder} ${version}`)

test('the check sees every TanStack package web/package.json asks for', () => {
  // A package the lockfile lacks, Vercel's npm install resolves afresh, to the newest version its
  // range allows, where the checks below can't see it.
  const manifest = read('../../package.json')
  const asked = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
    (name) => name.startsWith('@tanstack/'),
  )
  assert.deepEqual(
    asked.filter((name) => !tanstack.some((entry) => entry.name === name)),
    [],
    'in web/package.json but not in package-lock.json',
  )
})

test('package-lock.json installs one copy of TanStack’s query-core', () => {
  const copies = tanstack.filter(({ name }) => name === '@tanstack/query-core')
  assert.equal(
    copies.length,
    1,
    `query-core is installed ${copies.length} times: ${listed(copies).join(', ')}`,
  )
})

test('every TanStack package is at query-core’s version, so none needs a copy of its own', () => {
  // The copy in node_modules/@tanstack/, which every package without a copy of its own uses.
  const core = tanstack.find(({ folder }) => folder === 'node_modules/@tanstack/query-core')
  assert.deepEqual(
    listed(tanstack.filter(({ version }) => version !== core?.version)),
    [],
    `TanStack packages not at query-core’s version, ${core?.version}`,
  )
})
