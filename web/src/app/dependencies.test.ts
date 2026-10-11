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
