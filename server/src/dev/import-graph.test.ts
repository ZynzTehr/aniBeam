import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('../', import.meta.url))

/**
 * The files under src/ that `entry` reaches through its imports, and theirs, as TypeScript reads
 * them: import and export from, import type, and import() of a string.
 */
function reached(entry: string) {
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true)
    for (const { fileName } of importedFiles) {
      if (!fileName.startsWith('.')) continue
      const next = path.resolve(path.dirname(file), fileName)
      assert.ok(existsSync(next), `${path.relative(SRC, file)} imports ${fileName}, not found`)
      walk(next)
    }
  }
  walk(path.join(SRC, entry))
  return [...seen].map((file) => path.relative(SRC, file)).sort()
}

test('src/index.ts, the production entry, never reaches src/dev/', () => {
  const files = reached('index.ts')
  // What it does reach, so the walk is known to follow imports.
  for (const file of ['app.ts', 'auth/verify.ts', 'config.ts', 'routes/history.ts'])
    assert.ok(files.includes(file), `${file} not reached: ${files.join(', ')}`)
  assert.deepEqual(
    files.filter((file) => file.startsWith(`dev${path.sep}`)),
    [],
  )
})

test('the walk finds the dev sign-in from the dev entry', () => {
  assert.ok(reached(path.join('dev', 'demo.ts')).includes(path.join('dev', 'verify.ts')))
})
