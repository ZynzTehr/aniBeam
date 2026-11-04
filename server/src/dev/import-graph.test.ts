import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('../', import.meta.url))

/**
 * What in `text` loads a module by a name the walk can't read: import() of anything but a string
 * written out, require and createRequire, and import.meta.resolve. Any of these could reach
 * src/dev/ unseen.
 */
function unfollowed(text: string) {
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments
      const callee = node.expression
      if (
        (callee.kind === ts.SyntaxKind.ImportKeyword &&
          !(first && ts.isStringLiteralLike(first))) ||
        (ts.isIdentifier(callee) && ['require', 'createRequire'].includes(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isMetaProperty(callee.expression) &&
          callee.name.text === 'resolve')
      )
        found.push(node.getText())
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, true))
  return found
}

/**
 * The files under src/ that `entry` reaches through its imports, and theirs, as TypeScript reads
 * them: import and export from, import type, and import() of a string. A file that loads a
 * module any other way, or names one of ours by anything but a relative path, fails the walk.
 */
function reached(entry: string) {
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    const name = path.relative(SRC, file)
    assert.deepEqual(unfollowed(text), [], `${name} loads a module the walk can't follow`)
    const { importedFiles } = ts.preProcessFile(text, true, true)
    for (const { fileName } of importedFiles) {
      // Packages, by their names: a path or a file: URL would be one of our files.
      assert.ok(
        !fileName.startsWith('/') && !fileName.startsWith('file:'),
        `${name} imports ${fileName}, which isn't a relative path or a package`,
      )
      if (!fileName.startsWith('.')) continue
      const next = path.resolve(path.dirname(file), fileName)
      assert.ok(existsSync(next), `${name} imports ${fileName}, not found`)
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

test("the walk refuses a module loaded by a name it can't read", () => {
  for (const text of [
    "const p = './dev/verify.ts'; await import(p)",
    "await import(new URL('./dev/verify.ts', import.meta.url).href)",
    'await import(`./dev/${name}.ts`)',
    "createRequire(import.meta.url)('./dev/verify.ts')",
    "require('./dev/verify.ts')",
    "import.meta.resolve('./dev/verify.ts')",
  ])
    assert.notDeepEqual(unfollowed(text), [], text)
  assert.deepEqual(unfollowed("await import('./dev/verify.ts'); new URL('a', import.meta.url)"), [])
})

test('the walk finds the dev sign-in from the dev entry', () => {
  assert.ok(reached(path.join('dev', 'demo.ts')).includes(path.join('dev', 'verify.ts')))
})
