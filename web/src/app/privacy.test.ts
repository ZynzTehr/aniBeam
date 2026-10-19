import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob, relative, resolve } from 'node:path'
import { before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'
import ts from 'typescript'
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

// Development-only code: the Phase 2 design prototypes in src/prototype, the component gallery in
// src/gallery, and GSAP's ScrollTrigger, which only the draft scroll prototype used. main.tsx
// opens the prototypes and the gallery by address, inside import.meta.env.DEV, which a production
// build reads as false, so the pages, their files and the address checks are all left out. This
// reads the build for any trace of them: a file made from their folders (a stylesheet of theirs
// would join the app's own, under its name), a file named like one, the prototypes' switcher
// label, the gallery's heading, ScrollTrigger's name, or a check of the address for one: the word
// gallery anywhere (nothing that ships holds it), or variant as a word of its own, quoted or in
// ?variant=, as a check names it (React DOM's font-variant and fontVariant hold it inside a word).
// A stylesheet of theirs brought in by a CSS @import leaves no trace among the files the build was
// made from, so the production stylesheet is also read for a class that only their stylesheets
// name.
const DEVELOPMENT_ONLY = {
  folders: /^src\/(gallery|prototype)\//i,
  names: /gallery|prototype|variant/i,
  markers: ['Design prototype switcher', 'AniBeam component gallery', 'ScrollTrigger'],
  addresses: /gallery|(?<![\w-])variant(?![\w-])/gi,
}

// The class names in a stylesheet's selectors, unescaped, as Tailwind writes md:flex as .md\:flex.
// Comments, strings and url()s go first, as they can hold a dot (an SVG's www.w3.org, say), and
// only the text before each block's brace is read.
const classesIn = (css: string) => {
  // In one pass, so that a comment's mark inside a string, or a string's inside a comment, is read
  // as part of what holds it.
  const code = css.replace(/\/\*[\s\S]*?\*\/|url\([^)]*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')
  const selectors = [...code.matchAll(/([^{};]*)\{/g)].map(([, selector]) => selector)
  return new Set(
    selectors.flatMap((selector) =>
      [...selector.matchAll(/\.(-?(?:[_a-zA-Z]|\\.)(?:[\w-]|\\.)*)/g)].map(([, name]) =>
        name.replace(/\\(.)/g, '$1'),
      ),
    ),
  )
}

test('the production build holds no development-only code', () => {
  // So that a reading that misses can't pass, the pattern must find checks of the address however
  // they are written, and pass over React DOM's words.
  for (const check of [
    'new URLSearchParams(location.search).has(`variant`)',
    "location.search.includes('gallery')",
    'new URLSearchParams(location.search).get("variant")',
    "location.search.startsWith('?variant=')",
    '/[?&]variant=/.test(location.search)',
  ])
    assert.equal(check.match(DEVELOPMENT_ONLY.addresses)?.length, 1, `the pattern misses ${check}`)
  for (const word of ['font-variant-numeric', 'fontVariant', 'fontVariantCaps'])
    assert.equal(word.match(DEVELOPMENT_ONLY.addresses), null, `the pattern takes ${word}`)
  // The classes only the development-only stylesheets name: theirs, less any a shipped one names.
  const stylesheets = readdirSync(join(web, 'src'), { encoding: 'utf8', recursive: true })
    .map((path) => join('src', path))
    .filter((path) => path.endsWith('.css'))
  const named = (development: boolean) =>
    stylesheets
      .filter((path) => DEVELOPMENT_ONLY.folders.test(path) === development)
      .flatMap((path) => [...classesIn(readFileSync(join(web, path), 'utf8'))])
  const shippedClasses = new Set(named(false))
  const developmentClasses = new Set(named(true).filter((name) => !shippedClasses.has(name)))
  assert.ok(
    developmentClasses.has('gal-part') && developmentClasses.has('proto-switcher'),
    "this reading misses the gallery's or the prototypes' classes",
  )
  const traces = output.flatMap((file) => {
    const text = file.type === 'chunk' ? file.code : Buffer.from(file.source).toString('utf8')
    return [
      ...(file.type === 'chunk' ? file.moduleIds : file.originalFileNames)
        .map(fromWeb)
        .filter((source) => DEVELOPMENT_ONLY.folders.test(source))
        .map((source) => `${file.fileName}, made from ${source}`),
      ...(DEVELOPMENT_ONLY.names.test(file.fileName) ? [`${file.fileName}, by its name`] : []),
      ...DEVELOPMENT_ONLY.markers
        .filter((marker) => text.includes(marker))
        .map((marker) => `${file.fileName}: "${marker}"`),
      ...[...text.matchAll(DEVELOPMENT_ONLY.addresses)].map(
        ([found]) => `${file.fileName}: ${found}`,
      ),
      ...(file.fileName.endsWith('.css') ? [...classesIn(text)] : [])
        .filter((name) => developmentClasses.has(name))
        .map((name) => `${file.fileName}: .${name}, a development-only class`),
    ]
  })
  assert.deepEqual(
    traces,
    [],
    'the production build holds these traces of development-only code (should a shipped feature ever say "gallery", narrow that word here)',
  )
})

// web/public is copied into the production site as it is, outside the build read above, so a file
// a development page left there would ship unseen. None may be named like one.
test('nothing in web/public is named like a development-only page', () => {
  const files = readdirSync(join(web, 'public'), { encoding: 'utf8', recursive: true })
  // So that a reading that misses can't pass, it must find the fonts.
  assert.ok(
    files.some((path) => path.endsWith('.woff2')),
    "this reading misses web/public's fonts",
  )
  assert.deepEqual(
    files.filter((path) => DEVELOPMENT_ONLY.names.test(path)).map((path) => join('public', path)),
    [],
    'these files in web/public are named like development-only pages, and would ship',
  )
})

// Tailwind makes a utility of any word that names one in the files it reads, even in a comment, so
// styles/index.css has it read only the app's own code. These are canaries: utilities named only
// in files it mustn't read, in the tests (such as this comment's italic and underline), the
// prototypes, the gallery and the scripts. A rule for any of them in the production stylesheet
// means Tailwind read where it shouldn't. Its rule for sr-only, which the app uses, shows it still
// reads the app.
const CANARIES = {
  italic: 'src/app/privacy.test.ts',
  underline: 'src/app/privacy.test.ts',
  overline: 'src/prototype/Prototype.tsx',
  capitalize: 'src/gallery/Gallery.tsx',
  'line-through': 'scripts/refresh-samples.ts',
}

// The production stylesheet, as text.
const productionCss = () =>
  output
    .filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'))
    .map((file) => (file.type === 'asset' ? Buffer.from(file.source).toString('utf8') : ''))
    .join('\n')

test("the production stylesheet is made from the app's own code, not its tests or development pages", () => {
  const css = productionCss()
  const ruled = (utility: string) => new RegExp(`\\.${utility}\\{`).test(css)
  assert.ok(
    ruled('sr-only'),
    'the production stylesheet has no rule for sr-only, which the app uses',
  )
  // A canary taken out of its file would pass without proving anything.
  for (const [utility, file] of Object.entries(CANARIES))
    assert.match(readFileSync(join(web, file), 'utf8'), new RegExp(`\\b${utility}\\b`), file)
  assert.deepEqual(
    Object.entries(CANARIES)
      .filter(([utility]) => ruled(utility))
      .map(([utility, file]) => `.${utility}, named in ${file}`),
    [],
    "the production stylesheet has rules for words found only in files Tailwind mustn't read",
  )
})

// No test is a .tsx file yet, so none can hold a canary for that half of index.css's skipped tests.
// So its @source not lines are read as Tailwind reads them, outside comments, from the stylesheet's
// own folder, and must skip a test of either kind anywhere in src.
test('Tailwind skips every test in src, .ts and .tsx alike', () => {
  const stylesheet = join(web, 'src/styles/index.css')
  const skipped = [
    ...readFileSync(stylesheet, 'utf8')
      // Comments go, strings stay, in one pass: '../**/*.test.ts' holds a /**/ of its own.
      .replace(/\/\*[\s\S]*?\*\/|("[^"]*"|'[^']*')/g, (_, string?: string) => string ?? '')
      .matchAll(/@source\s+not\s+(["'])(.+?)\1/g),
  ].map(([, , glob]) => fromWeb(resolve(dirname(stylesheet), glob)))
  const tests = ['src/app/a.test.ts', 'src/features/mood/a.test.tsx', 'src/b.test.tsx']
  assert.deepEqual(
    tests.filter((test) => !skipped.some((glob) => matchesGlob(test, glob))),
    [],
    `Tailwind reads these tests: index.css skips only ${skipped.join(', ')}`,
  )
})

// Every class in a className of the app's own code, with the file that sets it. TypeScript's
// parser reads the markup, so a word in a comment or the page's text doesn't count.
function classNamesInApp() {
  const used = new Map<string, string>()
  const scripts = readdirSync(join(web, 'src'), { encoding: 'utf8', recursive: true })
    .map((path) => join('src', path))
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) => !DEVELOPMENT_ONLY.folders.test(path))
  for (const file of scripts) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(web, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    // Every string in a className's value, such as both of loading ? 'ab-a is-b' : 'ab-a'.
    const read = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node))
        for (const name of node.text.split(/\s+/)) if (name) used.set(name, file)
      node.forEachChild(read)
    }
    source.forEachChild(function visit(node) {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'className' && node.initializer)
        read(node.initializer)
      node.forEachChild(visit)
    })
  }
  // So that a reading that misses can't pass, it must find the app's own classes and sr-only.
  assert.ok(used.has('ab-panel') && used.has('sr-only'), "this reading misses the app's classes")
  return used
}

// The other way round: Tailwind told to read too little would leave out the rule of a class the
// app uses, without a word. So every class the app's markup sets, but for its own ab- and is-
// classes, must have its rule in the production stylesheet.
test('every Tailwind class the app uses has its rule in the production stylesheet', () => {
  const ruled = classesIn(productionCss())
  assert.deepEqual(
    [...classNamesInApp()]
      .filter(([name]) => !/^(ab|is)-/.test(name) && !ruled.has(name))
      .map(([name, file]) => `${name}, in ${file}`),
    [],
    'the production stylesheet has no rule for these Tailwind classes: Tailwind skips their files',
  )
})

// Classes the markup sets that no rule styles, on purpose: the trending page's empty panels, which
// the gallery's checks count, and the title card's text column, a plain block.
const UNSTYLED = ['ab-skeleton', 'ab-sheet-copy']

// And the app's own classes: a misspelt one, such as ab-slider-header for ab-slider-head, styles
// nothing, without a word. Each must have a rule in the app's stylesheets (all of src's but the
// development-only pages'), as written, not as built: a component's own stylesheet ships only with
// it. A class made in code, as ab-${rarity.key} is, reads as its start, ab-, and is passed over.
test("every one of the app's own classes in its markup has a rule in its stylesheets", () => {
  const styled = new Set(
    readdirSync(join(web, 'src'), { encoding: 'utf8', recursive: true })
      .map((path) => join('src', path))
      .filter((path) => path.endsWith('.css') && !DEVELOPMENT_ONLY.folders.test(path))
      .flatMap((path) => [...classesIn(readFileSync(join(web, path), 'utf8'))]),
  )
  const used = classNamesInApp()
  // The list of unstyled classes must stay true, so that it can't hide one.
  for (const name of UNSTYLED) {
    assert.ok(used.has(name), `${name} is no longer used: take it off the list`)
    assert.ok(!styled.has(name), `${name} has a rule now: take it off the list`)
  }
  assert.deepEqual(
    [...used]
      .filter(([name]) => /^(ab|is)-/.test(name) && !name.endsWith('-'))
      .filter(([name]) => !styled.has(name) && !UNSTYLED.includes(name))
      .map(([name, file]) => `${name}, in ${file}`),
    [],
    "these classes in the app's markup have no rule in its stylesheets: misspelt?",
  )
})

// The bundle's weight, as each PR reports it: every file brotli-compressed at quality 11. Each part
// must stay within its budget, its size rounded up to the next 500 bytes (on 2026-10-15: the JS
// every visit loads, 78,154 B; the CSS, 8,291 B, once Tailwind read only the app's own code; the
// JS loaded only when needed, the samples for when AniList can't be reached, 3,337 B; and every
// other file the build makes, index.html and any a module imports, such as an image, 342 B). A
// change that needs more raises its number here and says why. The CSS rose to 8,502 B with the
// layout and keyboard work (the status tags, the room kept for focus rings, the title card's own
// ring in two tones), then past 9,000 B with the page's section links (the header's links waiting
// hidden, the current section in yellow: 9,016 B), and past 9,500 B with a phone's one-row header
// and its menu (the hamburger, the manga-panel menu and its slide: 10,013 B), so its budget is
// 10,500 B. The JS every visit loads passed 78,500 B with the scroll slam's landing
// (lib/landing.ts, 78,954 B with its follow-ups), then 79,000 B with the request for one title on
// its own (titleQuery, for title addresses: 79,019 B), 79,500 B with opening a title at its
// address (lib/route.ts, the note in place of a card: 79,519 B), 80,000 B with the title
// addresses' review fixes (the note's fade-out among them: 80,043 B), 80,500 B with the section
// links (lib/sectionNav.ts, docking the intro's buttons: 80,741 B), 81,000 B with a phone's bar of
// them (81,118 B, since taken out), 81,500 B with the buttons' flight into the header and back
// (82,032 B), 82,500 B with the phone's menu in the bar's place (MenuDrawer, the hamburger:
// 82,508 B), and 83,000 B with its swipes (lib/swipe.ts, a swipe across the header to open it and
// a drag that it follows to shut it: 83,262 B), so its budget is 83,500 B. The fonts in
// web/public are copied as they are, outside the build, so this doesn't weigh them.
const BUDGET = {
  'the JS every visit loads': 83_500,
  'the CSS': 10_500,
  'the JS loaded only when needed': 3_500,
  'every other file': 500,
}

const brotli = (content: string | Uint8Array) =>
  brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length

test('the production bundle stays within its byte budget', () => {
  // Every visit loads the entry and what it imports, but not what it imports only when asked to
  // (import()), as it does the samples.
  const chunks = output.filter((file) => file.type === 'chunk')
  const loaded = new Set<string>()
  const load = (name: string) => {
    if (loaded.has(name)) return
    loaded.add(name)
    chunks.find((chunk) => chunk.fileName === name)?.imports.forEach(load)
  }
  chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => load(chunk.fileName))
  const sizes: Record<keyof typeof BUDGET, number> = {
    'the JS every visit loads': 0,
    'the CSS': 0,
    'the JS loaded only when needed': 0,
    'every other file': 0,
  }
  for (const file of output) {
    if (file.type === 'chunk')
      sizes[
        loaded.has(file.fileName) ? 'the JS every visit loads' : 'the JS loaded only when needed'
      ] += brotli(file.code)
    else
      sizes[file.fileName.endsWith('.css') ? 'the CSS' : 'every other file'] += brotli(file.source)
  }
  // So that a reading that misses can't pass, it must find the app's code, its stylesheet and its
  // page.
  assert.ok(
    sizes['the JS every visit loads'] > 50_000 &&
      sizes['the CSS'] > 5_000 &&
      sizes['every other file'] > 200,
    `this reading misses part of the build: ${JSON.stringify(sizes)}`,
  )
  const over = Object.entries(BUDGET)
    .filter(([part, budget]) => sizes[part as keyof typeof BUDGET] > budget)
    .map(([part, budget]) => `${part}: ${sizes[part as keyof typeof BUDGET]} B, over ${budget} B`)
  assert.deepEqual(
    over,
    [],
    'over budget (brotli, quality 11): if the bytes are worth it, raise its budget and say why',
  )
})
