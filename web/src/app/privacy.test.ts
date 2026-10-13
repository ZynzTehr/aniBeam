import assert from 'node:assert/strict'
import { relative, resolve } from 'node:path'
import { before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build, type Rolldown } from 'vite'

const web = fileURLToPath(new URL('../../', import.meta.url))
// Vite names a file by its full path, or by its path from web/, with any ?query after it.
const fromWeb = (path: string) => relative(web, resolve(web, path))
// In upper case too: macOS finds '../E2E/…', and Vite keeps the case it was asked for.
const inE2e = (path: string) => /^e2e\//i.test(fromWeb(path))

// The production bundle, built in memory once for the checks below, fresh each run (web/dist can
// be missing or out of date).
let output: Rolldown.RolldownOutput['output']
before(async () => {
  // Vite keeps a NODE_ENV that is already set, and builds for production only if it is
  // "production". Under NODE_ENV=test or development, import.meta.env.DEV would be true and
  // main.tsx would let the prototype in, so the font check would fail for a font load that
  // never ships.
  process.env.NODE_ENV = 'production'
  const built = (await build({
    root: web,
    logLevel: 'silent',
    build: {
      write: false,
      // Vite writes a file under 4 KB into the code or CSS that names it, as a data: URL that
      // keeps no trace of where it came from, and some recordings are that small. Here a file
      // from e2e/ stays a file of its own instead, so the check for e2e/ below can name it. A
      // name ending in ?inline still gets a data: URL, as it asks for one. The app's own files
      // are inlined as Vite does by default.
      assetsInlineLimit: (file) => (inE2e(file) ? false : undefined),
    },
  })) as Rolldown.RolldownOutput
  output = built.output
})

// The fonts are self-hosted so visitors' browsers never contact Google. This checks every file
// in the build, whatever folder its code came from. The development-only prototypes do load
// Google Fonts, so this fails if a change ever lets them into production.
test('the production build never loads anything from Google Fonts', () => {
  assert.ok(
    output.some((file) => file.fileName === 'index.html'),
    'index.html is not in the build',
  )
  for (const file of output) {
    const text = file.type === 'chunk' ? file.code : Buffer.from(file.source).toString('utf8')
    assert.doesNotMatch(
      text,
      /fonts\.(googleapis|gstatic)\.com/,
      `${file.fileName} loads Google Fonts`,
    )
  }
})

// e2e/anilist/ holds AniList's answers, recorded for the browser checks and never to be shipped.
// dependencies.test.ts reads src for a path into e2e/ and names the line, but text can't show all
// that the build takes in: an alias set in vite.config.ts, a stylesheet's url(), index.html, a
// line that opens with a comment. So this reads what the build was made from, as Vite's own
// resolver found it: the modules in each chunk of code, and the original of every other file.
test('the production build holds nothing from e2e/, which must stay out of the app', () => {
  const sources = output.flatMap((file) =>
    (file.type === 'chunk' ? file.moduleIds : file.originalFileNames).map((id) => ({
      file: file.fileName,
      source: fromWeb(id),
    })),
  )
  // So that a broken reading can't pass by finding nothing, it must find the app's entry among
  // the modules, and the page as index.html's original.
  assert.ok(
    sources.some(({ source }) => source === 'src/main.tsx') &&
      sources.some(({ file, source }) => file === 'index.html' && source === 'index.html'),
    "this reading misses the build's src/main.tsx or index.html",
  )
  assert.deepEqual(
    sources.filter(({ source }) => inE2e(source)).map(({ file, source }) => `${file}: ${source}`),
    [],
    'these files in the production build were made from e2e/, which must stay out of the app',
  )
})
