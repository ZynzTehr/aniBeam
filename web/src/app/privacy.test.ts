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
// and its menu (the hamburger, the manga-panel menu and its slide: 10,013 B), and past 10,500 B
// with the title card's banner band (the band, its phone strip, the sheet's padding around it:
// 10,546 B; with its impact frame, drawn again for contrast themes, and the close button's white
// line over it, 10,642 B), and past 11,000 B with the card's status line (why AniList holds up a
// newer answer for a title opened at its address, with Try again, stuck to the screen's foot:
// 11,016 B; the synopsis and the tags had brought it to 10,934 B), so its budget is 11,500 B. The
// JS every visit loads passed 78,500 B with the scroll slam's landing (lib/landing.ts, 78,954 B
// with its follow-ups), then 79,000 B with the request for one title on its own (titleQuery, for
// title addresses: 79,019 B), 79,500 B with opening a title at its address (lib/route.ts, the note
// in place of a card: 79,519 B), 80,000 B with the title addresses' review fixes (the note's
// fade-out among them: 80,043 B), 80,500 B with the section links (lib/sectionNav.ts, docking the
// intro's buttons: 80,741 B), 81,000 B with a phone's bar of them (81,118 B, since taken out),
// 81,500 B with the buttons' flight into the header and back (82,032 B), 82,500 B with the phone's
// menu in the bar's place (MenuDrawer, the hamburger: 82,508 B), 83,000 B with its swipes
// (lib/swipe.ts, a swipe across the header to open it and a drag that it follows to shut it:
// 83,262 B), and 83,500 B with a phone's header hiding as the page scrolls down and coming back as
// it scrolls up (topAfter in lib/sectionNav.ts, and the landing observer following it: 83,529 B),
// and 84,000 B with the phone header no longer moved by a heading whose ring a tap hid (in
// lib/sectionNav.ts: 84,044 B; with the search box losing focus as a touch keyboard is put away,
// keyboardAfter in lib/searchBox.ts, 84,262 B), and 84,500 B with the swipe that opens the menu
// from anywhere on a phone's page, not the header alone (touch events on the document, opensFrom
// and rowScrolls in lib/swipe.ts keeping it off the search, a dialog and the decade strip, off
// selected text and a pinch: 84,720 B), and 85,000 B with the title card's synopsis (TitleDetails,
// its Read more measured again as the text changes size, and synopsis.ts, which reads AniList's
// markup into plain text: 85,844 B), and 86,000 B with its tags (tagsOf in the card, the spoiler
// tags behind their button: 86,020 B; with the card's status line and its Try again, 86,148 B), and
// 86,500 B with the synopsis's entities by name, HTML's whole Latin-1 set and its typographic marks
// (Nausicaä's ä showed as "&auml;": 86,667 B), and 87,000 B with the 30-day cache (keptFor, the
// saved copy bringing back each answer only while it is kept, and each save waiting for the page
// to draw what just arrived: 87,087 B), and 87,500 B with the trailer (trailerOf and embedOf,
// Watch trailer and its dialog, and the history entry that lets Back close it: 87,645 B; its
// styles brought the CSS to 11,466 B, still within its budget), 88,000 B with My List in the
// title card (features/list/store.ts, the list kept in localStorage, merged title by title with
// another tab's copy and saved again after a storage event, and ListControls, Save, Want to try
// and Favorite with their line for a screen reader, which empties once another tab changes what
// the buttons show: 89,274 B; their row, its pair and its pressed look, in a contrast theme too,
// and the pair's hovered or focused button drawn over a pressed one, took the CSS past 11,500 B,
// to 11,668 B (the 11,647 B first written here was 21 B short), so the CSS's budget is now
// 12,000 B; the user agreed to the raises My List needs), 89,500 B; then 90,000 B with My List's
// page at /list (QUERIES.list and listQuery, its titles in one request, kept 30 days with their
// gcTime, the address kept with Discover's requests off there, and My List under a card opened over
// it: 89,744 B), and 91,000 B with the page itself (features/list/view.ts and ListPage: its tabs
// and Favorites only as links that change the address, each view's titles taken as it opens, empty
// cards holding the places of titles still to come, the copies other answers hold shown at once,
// the empty states and notes: 90,549 B; their styles brought the CSS to 11,824 B, still within its
// budget), and 91,500 B with its states (90,840 B with the Undo before them: the titles AniList's
// answer leaves out, holding their places, with Remove them, a failed answer leaving out none, the
// samples filling in while AniList is out of reach, and offline: 91,172 B; their styles brought the
// CSS to 11,849 B); then My List's page became a file of its own (features/list/page.ts), which
// left the JS every visit loads at 90,164 B with what loads it and the line in its place should it
// fail, so its budget was 90,500 B. The header's My List becoming a link to /list, marked current
// there, which it and AniBeam reach with no new page on a plain click, took it to 90,539 B for a
// while (its yellow, shared with the current section's link, left the CSS at 11,878 B). With the
// phone menu's My List a link too, and the intro's, the Soon look My List's flying copy had went
// from the CSS, which came down to 11,830 B; with the section links on My List leading to
// Discover's sections, AniBeam's jump to the top and My List's heading taking focus as its links
// are followed, the JS every visit loads is 90,440 B, and 90,468 B (CSS 11,839 B) with the search
// bubble measured before its first frame, so its budget stayed 90,500 B; then 91,000 B with Read
// more and Show less moving the synopsis's height smoothly, its fade sliding with it, a second
// press turning it back from where it is, the button kept in view as it moves (the user asked for
// it not to jolt open: 90,661 B; the fade's taller mask left the CSS at 11,856 B), 90,873 B with
// the reader's place kept as it opens, a text that reflows as it opens growing on to its new
// height, and the fade moved by its prefixed name too, and 90,864 B with a pointer's press opening
// it where the reader is and a key's bringing its focused button into view once it has opened;
// then 91,500 B with Discover's pull skipping the titles on My List and the last 30 pulled
// (features/mood/roll.ts, rollNext and pullNext, and the machine reading My List: 91,183 B, then
// 91,217 B, 353 B more, once an empty roll also says more titles are needed, needMore), a raise
// shown to the user in Phase 5's pull request and waiting for their OK. The README's
// "Byte budgets now" table gives the same budgets, and readme.test.ts holds it to them. My List's
// page itself, ListPage and features/list/view.ts, is 2,322 B (2,329 B as the main file it imports
// takes a new name with each change to it), so its own budget is 2,500 B (the user agreed to about
// 3,000 B, the plan's D18); the grid's covers kept their focus rings on a phone's screen with a
// wider scroll margin (11,866 B of CSS, before the Soon look went). The JS loaded only when needed
// rose to 14,028 B when the samples began to carry each title's synopsis, running time and the tags
// its card shows, as the lists' titles do, so that a sample's card opens on them with no request
// (the user agreed to about 15 KB more, gzipped), so its budget is 14,500 B. The mood scoring
// (features/mood/scoring.ts, score.ts and the mood map) is a file of its own, loaded once the
// browser is idle after the page has drawn, never before it draws: 910 B, so its budget is 1,500 B
// (the user agreed to that budget, Phase 5's D5). Its loader, which tries again after a failure,
// and the idle preload took the JS every visit loads from 91,217 B to 91,344 B, within its budget.
// A decade's mood pool took it to 91,375 B: its query's text in QUERIES, which the saved copy's
// reading keeps whole (restored, in queryClient.ts), though nothing asks for a pool yet; the mood
// map's tags the pool keeps, MOOD_TAGS, took the mood scoring to 955 B. Then 91,600 B with a
// decade's page going in one request with its pool when both ask at once (together, decadeWithPool
// and the page's query reading the pool's key: 91,558 B, 183 B more, a raise shown to the user in
// PR 3a, as the plan's D5 lets the budget rise in measured steps); then 91,700 B with the saved
// copy keeping only the 3 newest decades' mood pools (newestPools, in queryClient.ts: 91,641 B).
// The page deciding that by itself, from a pool said to be wanted (wantPool, in place of together),
// took it back to 91,542 B. Then 92,300 B with the three mood sliders in place of the vibe chips
// on Discover's machine (PullMachine with MoodSlider, a tap on a track setting its stop, Reset
// moods, the sliders ranking the titles through the mood scoring, and the sliders, the last pulls
// and the pulled title kept for the visit in features/mood/session.ts, less the vibes and pullNext:
// 92,203 B, 661 B more), and the CSS 12,400 B, as MoodSlider.css now ships with every visit (the
// slider's look, less the vibe chips' rules: 12,324 B, 468 B more); raises the plan's D5 lets come
// in measured steps. Then 92,900 B with the machine following the decade below it and asking for
// its mood pool only once wanted (the pool's query and its cut, poolOf, now in the code every
// visit loads, the wanted rule kept per decade for the visit, and the decade's page told to ask
// for the pool with it: 92,789 B, 586 B more). Then 93,400 B with the machine's top 3 under the
// pulled title, each with its cover, rarity sticker and Why line (features/mood/Matches.tsx), the
// "Most popular in the 1990s" heading, the dome in the best matches' colors, and a refresh of the
// pool held while the matches are on screen (features/mood/heldPool.ts): 93,284 B, 495 B more;
// and the CSS 12,500 B for the matches' fixed slots (12,481 B, 157 B more). Raises the plan's D5
// lets come in measured steps. Then 93,550 B with the machine's line over the matches ("Filling
// the machine…", the outage's samples, offline with no titles, AniList busy, and the mood scoring
// that didn't load, with Try again), the last decade's matches kept while a new one's pool is on
// its way, and the sliders off offline: 93,459 B, 175 B more; and the CSS 12,550 B for the line's
// room of two lines (12,501 B, 20 B more). Then 93,700 B with the review's fixes: the status line
// that says each pull also saying what holds the machine up (never the sliders' words), one sample
// title said as one, the line no longer "Filling the machine…" while nothing can come, the matches
// ranked, pulled and headed by the decade their titles come from (popularHeading), a pool that
// failed with the mood scoring asked for again once it loads, and a pool cut from a shared answer
// dated from when that request was sent: 93,643 B, 175 B more; the CSS still within 12,550 B with
// the line's room of three lines on a phone and Reset moods' border for contrast themes (12,506 B).
// Then 93,800 B with the same code: the top matches moved 1rem down, clear of the pulled title's
// rays, renamed the CSS file and so My List's page, whose new name in the import alone took the
// JS from 93,643 B to 93,711 B (its bytes uncompressed the same); the CSS 12,530 B. Then 93,900 B
// with the gacha's rolls (PR 4): the machine's words turned to "roll" (93,691 B), then a roll that
// skips another season of a show rolled in the last 30, the show found through the pool's seasons
// one to the next, and the line "Every match has come up once. Repeats start now." once only the
// last rolls are left: 93,892 B, 201 B more. Then the CSS 12,700 B for the roll's flip (F1, the
// user's pick): the card's two faces, its back in AniBeam's screentone with a ? stamp, turning in
// 3D after the capsule drops and pops open, timed from flip.ts: 12,697 B, 167 B more (the JS
// 93,810 B, within its budget). Then the CSS 12,800 B for the glow on the card's back before it
// turns, in the rarity's color, with motion allowed only: 12,776 B, 79 B more; and the JS 94,050
// B with no change to its code: the CSS file's new name renamed My List's page (ListPage-*.js),
// and that name in the import alone took the JS from 93,810 B to 94,014 B, its bytes uncompressed
// the same.
// Then 94,200 B with the rolled card in full (the plan's A10 and A11): the title's My List row
// (ListControls, already in the code every visit loads, its line given an id of its own), Details
// and Roll again, whose focus a roll from it hands to the new card's, the Why line and the rarity's
// rule: 94,141 B, 141 B more than 94,000 B; and the CSS 12,850 B for the card's text keeping one
// size from roll to roll and its rays fitted to its poster beside the text: 12,836 B, 62 B more.
// Then 94,500 B with page 3 and the end states (the plan's A12): the pool's page 3, its query's
// text in QUERIES (about 150 B on its own), asked for once by a roll made with fewer than 10 of the
// pool's titles left to come up, its titles added to the pool's; the saved copy keeping a page 3
// only with its pool; the line saying "Only N titles left to roll in this decade." and, with a card
// rolled, that everything is on My List; and each roll saying the line as it left it, kept with
// that roll: 94,439 B, 298 B more. The gacha (PR 4) in all: the JS every visit loads from 93,711 B
// to 94,439 B, 728 B more, about 200 B of it a renamed file in an import (the plan said 600 to 800
// B), and the CSS from 12,530 B to 12,836 B, 306 B more (the plan said 400 to 550 B).
// Then 94,600 B with the review's fix for page 3 on its way: no line, nor any roll, says repeats
// start or how few are left until it lands or fails, AniList's 429 on it shows the busy line, and
// a page 3 that failed with the mood scoring is asked for again once it loads: 94,550 B, 111 B
// more. Then the CSS 12,900 B for the review's fix to a first roll from 821 to 1170px, where the
// rolled card stacks beside the machine: its row keeps the card's room from the start, and the
// machine tops it, so the lever and what is under the card stay put: 12,869 B, 33 B more. And the
// JS 94,521 B, 29 B fewer, with no change to what it does: the rarity's rule moved into moods.ts.
// The fonts in web/public are copied as they are, outside the build, so this doesn't weigh them.
const BUDGET = {
  'the JS every visit loads': 94_600,
  'the CSS': 12_900,
  'the JS loaded only when needed': 14_500,
  'My List’s page': 2_500,
  'the mood scoring': 1_500,
  'every other file': 500,
}

// My List's page, a file of its own (see features/list/page.ts), weighed apart from the samples.
const LIST_PAGE = 'src/features/list/ListPage.tsx'

// The mood scoring, a file of its own (see features/mood/loadScoring.ts): scoring.ts and the
// scoring it hands Discover's machine by import(), score.ts and the mood map, weighed apart too.
const MOOD_SCORING = [
  'src/features/mood/scoring.ts',
  'src/features/mood/score.ts',
  'src/features/mood/moodMap.ts',
]

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
    'My List’s page': 0,
    'the mood scoring': 0,
    'every other file': 0,
  }
  // My List's page is loaded only when needed, or once the browser is idle after the list holds a
  // title, never with every visit, and in a file of its own, which holds none of the samples.
  const page = chunks.filter((chunk) => chunk.moduleIds.map(fromWeb).includes(LIST_PAGE))
  assert.deepEqual(
    page.map((chunk) => ({
      everyVisit: loaded.has(chunk.fileName),
      samples: chunk.moduleIds.map(fromWeb).includes('src/features/anime/samples.ts'),
    })),
    [{ everyVisit: false, samples: false }],
    `My List's page must be one file of its own, loaded only when needed: ${LIST_PAGE}`,
  )
  // The mood scoring is loaded once the browser is idle after the page has drawn, never with what
  // every visit loads before it draws, and all of it in one file of its own, which holds none of
  // the samples: a static import of score.ts from code every visit loads would split it.
  const scoring = chunks.filter((chunk) =>
    chunk.moduleIds.map(fromWeb).some((id) => MOOD_SCORING.includes(id)),
  )
  assert.deepEqual(
    scoring.map((chunk) => ({
      everyVisit: loaded.has(chunk.fileName),
      samples: chunk.moduleIds.map(fromWeb).includes('src/features/anime/samples.ts'),
      holds: MOOD_SCORING.filter((id) => chunk.moduleIds.map(fromWeb).includes(id)),
    })),
    [{ everyVisit: false, samples: false, holds: MOOD_SCORING }],
    `the mood scoring must be one file of its own, loaded only when needed: ${MOOD_SCORING}`,
  )
  for (const file of output) {
    if (file.type === 'chunk')
      sizes[
        loaded.has(file.fileName)
          ? 'the JS every visit loads'
          : page.includes(file)
            ? 'My List’s page'
            : scoring.includes(file)
              ? 'the mood scoring'
              : 'the JS loaded only when needed'
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
