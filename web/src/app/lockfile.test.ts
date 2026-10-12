import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// TanStack Query's packages pin query-core, directly or through each other, at their own version
// exactly: react-query 5.104.1 needs query-core 5.104.1, and the async persister 5.104.2 needs
// 5.104.2. So a TanStack Query package a version apart from the rest brings a second query-core,
// which npm nests under it, and the app then runs code from both copies, each with its own timers
// and state. Vercel installs what this lockfile says, so the lockfile shows a second copy before
// it ships.
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const lockfile = read('../../../package-lock.json')

// Each TanStack package the lockfile installs. npm puts each in node_modules/@tanstack/, or, when
// a package needs a version other than the one there, in that package's own node_modules. Under an
// alias ("qc": "npm:@tanstack/query-core@5.104.2") it goes in node_modules/qc instead, and npm
// writes the package's real name into its entry, so each is known by that name when npm writes
// one, and by its folder otherwise.
type Entry = { name?: string; version: string; dependencies?: Record<string, string> }
const tanstack = Object.entries<Entry>(lockfile.packages).flatMap(([folder, entry]) => {
  const installedAs = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(folder)?.[1]
  const name = installedAs && (entry.name ?? installedAs)
  return name?.startsWith('@tanstack/')
    ? [{ folder, name, version: entry.version, needs: Object.keys(entry.dependencies ?? {}) }]
    : []
})
// Each package's folder and version, and its real name too when an alias hides it.
const listed = (entries: typeof tanstack) =>
  entries.map(({ folder, name, version }) =>
    folder.endsWith(`/${name}`) ? `${folder} ${version}` : `${folder} (${name}) ${version}`,
  )

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

test('package-lock.json was written for web/package.json as it is now', () => {
  // The check above catches a lockfile that has fallen behind only when a package is missing from
  // it. Raise a range in web/package.json past the version the lockfile holds (the async persister
  // to ^5.104.2, say) and every package is still there, so the other checks here pass, yet Vercel's
  // npm install resolves that package afresh, with a query-core of its own. This check sees that
  // too: npm install copies web/package.json's dependencies and devDependencies into the lockfile's
  // record of web, so the two differ once web/package.json changes and the lockfile doesn't.
  const manifest = read('../../package.json')
  const recorded = lockfile.packages.web
  assert.deepEqual(
    { dependencies: recorded.dependencies, devDependencies: recorded.devDependencies },
    { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies },
    'package-lock.json (+) doesn’t match web/package.json (-): run npm install from the repo root',
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

test('every TanStack Query package is at query-core’s version, so none needs a second copy', () => {
  // TanStack Query's packages: query-core, query-persist-client-core, and each TanStack package
  // that needs either, which is how it pins query-core. TanStack's other libraries, such as
  // Virtual, Router, or match-sorter-utils (which the devtools need), have version numbers of
  // their own and bring no query-core.
  const cores = ['@tanstack/query-core', '@tanstack/query-persist-client-core']
  const query = tanstack.filter(
    ({ name, needs }) => cores.includes(name) || needs.some((need) => cores.includes(need)),
  )
  // The copy in node_modules/@tanstack/, which every package without a copy of its own uses.
  const core = tanstack.find(({ folder }) => folder === 'node_modules/@tanstack/query-core')
  assert.deepEqual(
    listed(query.filter(({ version }) => version !== core?.version)),
    [],
    `TanStack Query packages not at query-core’s version, ${core?.version}`,
  )
})
