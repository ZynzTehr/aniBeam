import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Vercel builds the web app with only web/package.json's packages installed, so a package
// that this repo's root happens to have (the root's prettier, say) builds here and fails there.
const web = fileURLToPath(new URL('../../', import.meta.url))

function sources(folder: string): string[] {
  return readdirSync(join(web, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// The package an import names: '@scope/name/deep' gives '@scope/name', 'name/deep' gives 'name'.
const packageOf = (specifier: string) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/')

test('every package web/ imports is in web/package.json, so a web-only install builds', () => {
  const manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'))
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
  const files = ['vite.config.ts', ...sources('src'), ...sources('scripts'), ...sources('e2e')]
  assert.ok(files.length > 40, `only ${files.length} files found`)
  const missing: string[] = []
  for (const file of files) {
    // Comments can mention imports without making them.
    const code = readFileSync(join(web, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // import … from 'x', export … from 'x', import 'x' and import('x').
    const imports = code.matchAll(
      /(?:^|\n)\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    )
    for (const match of imports) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (/^[./]/.test(specifier) || specifier.startsWith('node:')) continue
      const name = packageOf(specifier)
      if (!declared.has(name) && !builtinModules.includes(name)) missing.push(`${file}: ${name}`)
    }
  }
  assert.deepEqual(missing, [], 'imported but not declared in web/package.json')
})

// e2e/anilist/ holds AniList's answers, recorded for the browser checks and never to be shipped.
// Yet tsc and Vite take an import of one from src without a word, and the build then carries it
// in the app, as it does every file that import.meta.glob() or import(`…${name}`) can match and
// the one new URL(…, import.meta.url) names. So every line of code is read for a path into e2e/,
// not just the imports: the folder's name after a quote or a slash, as in '../e2e/…', '/e2e/…'
// (Vite reads it from web/) or '@anibeam/web/e2e/…', in upper case too, which macOS also finds.
// Text can't show all that the build takes in, such as an alias or a stylesheet's url(), so
// privacy.test.ts reads the production build itself; this check stays for its message, which
// names the line.
function linesIntoE2e(file: string): string[] {
  return readFileSync(join(web, file), 'utf8')
    .split('\n')
    .flatMap((line, i) =>
      // Lines that start like a comment are skipped, as a comment can name a path without using
      // it. That's judged by line, not by /* */ span: '../e2e/**/*.json' holds a /**/ too.
      /^\s*(\/\/|\/?\*)/.test(line) || !/[/'"`]e2e\//i.test(line)
        ? []
        : [`${file}:${i + 1}: ${line.trim()}`],
    )
}

test('nothing in src names a path into e2e/, which must stay out of the app', () => {
  // The recorder in scripts/ imports from e2e/, as it may, so the reading must find that.
  assert.ok(
    linesIntoE2e('scripts/record-anilist.ts').length > 0,
    "this reading misses the recorder's imports from e2e/",
  )
  // Tests in src too: they have no need of e2e/, which has tests of its own.
  assert.deepEqual(
    sources('src').flatMap(linesIntoE2e),
    [],
    'these lines in src name a path into e2e/, which must stay out of the app',
  )
})
