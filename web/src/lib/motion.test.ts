import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  deviceReducesMotion,
  finishEntrances,
  reducedMotion,
  savedMotionChoice,
  saveMotionChoice,
  watchDeviceMotion,
  watchMotionBackOn,
  watchMotionOff,
} from './motion.ts'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** localStorage as far as lib/motion.ts uses it, refusing any value over `room` characters. */
function fakeStorage(room = Infinity) {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > room)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, value)
    },
    removeItem: (key: string) => void items.delete(key),
  }
}

/**
 * A page for lib/motion.ts to ask, on globalThis until the test ends, as Node has none: <html>,
 * whose data-motion is `dataset.motion`; a device that asks for reduced motion while `deviceAsks`
 * is true; localStorage, which is what `storage()` returns, or throws; and the page's animations,
 * which document.getAnimations() gives as `animations`, with its own clock, document.timeline, as
 * `clock`. A CSS animation is a CSSAnimation, as in a browser. In a browser, window is globalThis,
 * so each can be read through window too. `changeDevice()` changes the device's setting as a
 * visitor would while the page is open: each media query list that matchMedia gave out whose
 * answer changes then calls its own change listeners, as a browser's does. `resize()` has each
 * ResizeObserver that still watches something call back, as a browser's does once the size of
 * what it watches changes, and once as it starts watching.
 */
function fakePage(t: TestContext) {
  const before = [
    'window',
    'document',
    'matchMedia',
    'localStorage',
    'CSSAnimation',
    'ResizeObserver',
  ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  t.after(() => {
    for (const [name, descriptor] of before)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  const storage = fakeStorage()
  // Every media query list handed out, each with the change listeners added to it alone, and
  // whether each was added to be called once only.
  const lists: { query: string; listeners: Map<() => void, boolean> }[] = []
  // Every ResizeObserver made, each with its callback and what it watches.
  const observers: { callback: () => void; watching: Set<object> }[] = []
  const page = {
    dataset: {} as DOMStringMap,
    deviceAsks: false,
    storage: (): StorageLike => storage,
    animations: [] as object[],
    clock: {},
    changeDevice(asks: boolean) {
      const before = answers()
      page.deviceAsks = asks
      for (const { query, listeners } of lists)
        if (answers()[query] !== before[query])
          for (const [listener, once] of listeners) {
            if (once) listeners.delete(listener)
            listener()
          }
    },
    resize() {
      for (const { callback, watching } of observers) if (watching.size) callback()
    },
  }
  // A browser's answer to each media query about motion. A query it can't read matches nothing.
  const answers = (): Record<string, boolean> => ({
    '(prefers-reduced-motion)': page.deviceAsks,
    '(prefers-reduced-motion: reduce)': page.deviceAsks,
    '(prefers-reduced-motion: no-preference)': !page.deviceAsks,
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: { dataset: page.dataset },
      timeline: page.clock,
      getAnimations: () => page.animations,
    },
  })
  Object.defineProperty(globalThis, 'CSSAnimation', {
    configurable: true,
    value: class CSSAnimation {},
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      observer: { callback: () => void; watching: Set<object> }
      constructor(callback: () => void) {
        this.observer = { callback, watching: new Set() }
        observers.push(this.observer)
      }
      observe(target: object) {
        this.observer.watching.add(target)
      }
      unobserve(target: object) {
        this.observer.watching.delete(target)
      }
      disconnect() {
        this.observer.watching.clear()
      }
    },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const list = { query, listeners: new Map<() => void, boolean>() }
      lists.push(list)
      return {
        media: query,
        get matches() {
          return answers()[query] ?? false
        },
        addEventListener: (type: string, listener: () => void, options?: { once?: boolean }) =>
          type === 'change' && list.listeners.set(listener, Boolean(options?.once)),
        removeEventListener: (type: string, listener: () => void) =>
          type === 'change' && list.listeners.delete(listener),
      }
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => page.storage(),
  })
  return page
}

test('reducedMotion() is true when the site is set to reduce motion, or the device asks', (t) => {
  // The site's setting is data-motion="reduce" on <html>. Only that value counts, as it does for
  // an attribute selector, [data-motion='reduce'], so scripts and styles read it the same way.
  const page = fakePage(t)
  const answers: string[] = []
  for (const motion of [undefined, 'reduce', ''])
    for (const asks of [false, true]) {
      if (motion === undefined) delete page.dataset.motion
      else page.dataset.motion = motion
      page.deviceAsks = asks
      const setting = motion === undefined ? 'unset' : `"${motion}"`
      answers.push(
        `data-motion ${setting}, device ${asks ? 'asks' : 'allows motion'}: ${reducedMotion()}`,
      )
    }
  assert.deepEqual(answers, [
    'data-motion unset, device allows motion: false',
    'data-motion unset, device asks: true',
    'data-motion "reduce", device allows motion: true',
    'data-motion "reduce", device asks: true',
    'data-motion "", device allows motion: false',
    'data-motion "", device asks: true',
  ])
})

test('the device’s setting can be read and followed apart from the site’s, until the page stops watching', (t) => {
  // The footer's Reduce motion switch shows the site's setting, but while the device asks for
  // reduced motion, motion stays reduced whatever the site says, so the switch shows on and
  // locked. It must hear the device alone, and follow it as the visitor changes it with the page
  // open (React's useSyncExternalStore calls back to read it again), until it stops watching.
  const page = fakePage(t)
  page.dataset.motion = 'reduce'
  const heard: boolean[] = []
  const stop = watchDeviceMotion(() => heard.push(deviceReducesMotion()))
  const before = deviceReducesMotion()
  page.changeDevice(true)
  page.changeDevice(false)
  stop()
  page.changeDevice(true)
  assert.deepEqual(
    { before, heard },
    { before: false, heard: [true, false] },
    'with the site set to reduce motion, what the device’s setting read first, then as it changed twice while watched and once more after',
  )
})

test('finishEntrances() finishes the CSS animations on the page’s own clock, and leaves the rest to run', (t) => {
  // Turning motion back on starts the animations in the motion gates over on what is already on
  // the page, and those on the page's clock must finish at once. The splash cover's drift runs on
  // the scroll, and once finished it falls out of step with it. Transitions run on, as the switch's
  // knob slides off. An endless animation has no end to finish at: a browser's finish() throws.
  const page = fakePage(t)
  const finished: string[] = []
  const animation = (name: string, { css = true, timeline = page.clock, endTime = 600 } = {}) =>
    Object.assign(css ? new CSSAnimation() : {}, {
      timeline,
      effect: { getComputedTiming: () => ({ endTime }) },
      finish: () => {
        if (endTime === Infinity)
          throw new DOMException(
            'Cannot finish Animation with an infinite target effect end.',
            'InvalidStateError',
          )
        finished.push(name)
      },
    })
  page.animations = [
    animation('an entrance'),
    animation('the splash cover’s drift', { timeline: {} }),
    animation('the knob’s slide (a transition)', { css: false }),
    animation('an endless spin', { endTime: Infinity }),
  ]
  assert.doesNotThrow(finishEntrances, 'finishing the animations threw')
  assert.deepEqual(
    finished,
    ['an entrance'],
    'the animations finished, of an entrance, the splash cover’s drift on the scroll, the knob’s slide and an endless spin',
  )
})

test('watchMotionBackOn() calls back only as motion comes back on, not as it starts watching, until the page stops watching', (t) => {
  // Its ResizeObserver calls back as the motion gates widen the sentinel, and as they narrow it
  // again, and once as it starts watching, with nothing changed: on a page that loads with motion
  // allowed, the entrances have only just begun then, and finishing them would skip them. Only
  // motion coming back on may call back: the switch turning off, or the device that stops asking
  // while the switch is off. Each step changes the settings, then has the observer call back, as
  // if the sentinel's size had changed, which shows that the settings, not the call, decide.
  const page = fakePage(t)
  const heard: string[] = []
  let now = ''
  const step = (what: string, change = () => {}) => {
    now = what
    change()
    page.resize()
  }
  const sentinel = {} as Element
  let stop = watchMotionBackOn(sentinel, () => heard.push(now))
  step('as it starts watching, with motion allowed')
  step('the device asks', () => page.changeDevice(true))
  step('the device stops asking', () => page.changeDevice(false))
  step('the switch turns on', () => (page.dataset.motion = 'reduce'))
  step('the device asks, with the switch on', () => page.changeDevice(true))
  step('the device stops asking, with the switch on', () => page.changeDevice(false))
  step('the switch turns off', () => delete page.dataset.motion)
  stop()
  step('the switch turns on, once it stopped watching', () => (page.dataset.motion = 'reduce'))
  step('the switch turns off, once it stopped watching', () => delete page.dataset.motion)
  // A page that loads with the device asking.
  page.changeDevice(true)
  stop = watchMotionBackOn(sentinel, () => heard.push(now))
  step('as it starts watching, with the device asking')
  step('the device stops asking, on that page', () => page.changeDevice(false))
  stop()
  assert.deepEqual(
    heard,
    ['the device stops asking', 'the switch turns off', 'the device stops asking, on that page'],
    'the steps at which it called back',
  )
})

test('watchMotionOff() calls back only as motion turns off, not as it starts watching, until the page stops watching', (t) => {
  // Discover's machine ends a roll's flip at its last frame as motion turns off (see PullMachine):
  // the switch turning on, or the device that starts asking while the switch is off. Not as it
  // starts watching, nor as motion comes back on, nor as the other setting joins one already on.
  // As above, each step changes the settings, then has the observer call back.
  const page = fakePage(t)
  const heard: string[] = []
  let now = ''
  const step = (what: string, change = () => {}) => {
    now = what
    change()
    page.resize()
  }
  const sentinel = {} as Element
  let stop = watchMotionOff(sentinel, () => heard.push(now))
  step('as it starts watching, with motion allowed')
  step('the device asks', () => page.changeDevice(true))
  step('the switch turns on, with the device asking', () => (page.dataset.motion = 'reduce'))
  step('the device stops asking, with the switch on', () => page.changeDevice(false))
  step('the switch turns off', () => delete page.dataset.motion)
  step('the switch turns on', () => (page.dataset.motion = 'reduce'))
  step('the switch turns off again', () => delete page.dataset.motion)
  stop()
  step('the switch turns on, once it stopped watching', () => (page.dataset.motion = 'reduce'))
  step('the switch turns off, once it stopped watching', () => delete page.dataset.motion)
  // A page that loads with the device asking.
  page.changeDevice(true)
  stop = watchMotionOff(sentinel, () => heard.push(now))
  step('as it starts watching, with the device asking')
  step('the device stops asking, on that page', () => page.changeDevice(false))
  step('the device asks again, on that page', () => page.changeDevice(true))
  stop()
  assert.deepEqual(
    heard,
    ['the device asks', 'the switch turns on', 'the device asks again, on that page'],
    'the steps at which it called back',
  )
})

test('a choice to reduce motion is saved for later visits, and forgotten once turned off', (t) => {
  const page = fakePage(t)
  const storage = fakeStorage()
  page.storage = () => storage
  assert.equal(savedMotionChoice(), false, 'a first visit found a choice saved')
  saveMotionChoice(true)
  assert.deepEqual([...storage.items], [['anibeam:motion', 'reduce']], 'what turning it on saved')
  assert.equal(savedMotionChoice(), true, 'the saved choice did not read back')
  saveMotionChoice(false)
  assert.deepEqual([...storage.items], [], 'what turning it off left saved')
  assert.equal(savedMotionChoice(), false, 'the choice still read back once turned off')
})

test('with storage blocked or full, saving the choice and reading it back never throw', (t) => {
  // A browser can block a site's storage altogether ("block all site data"): reading localStorage
  // then throws (see storage.test.ts). Or the saved titles can fill it, and a new value is refused.
  // The page goes on either way, and the choice lasts for the visit only.
  const page = fakePage(t)
  const blocked = () => {
    throw new DOMException(
      "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
      'SecurityError',
    )
  }
  const full = fakeStorage(0)
  for (const [state, storage] of [
    ['blocked', blocked],
    ['full', () => full],
  ] as const) {
    page.storage = storage
    assert.doesNotThrow(
      () => saveMotionChoice(true),
      `with storage ${state}, saving the choice threw`,
    )
    let saved: boolean | undefined
    assert.doesNotThrow(() => {
      saved = savedMotionChoice()
    }, `with storage ${state}, reading the choice threw`)
    assert.equal(saved, false, `with storage ${state}, a choice that was never saved read back`)
    assert.doesNotThrow(
      () => saveMotionChoice(false),
      `with storage ${state}, forgetting the choice threw`,
    )
  }
})

// Asking about motion, in one place. The site's own setting, data-motion="reduce" on <html>, is
// out of a media query's sight, so a script that asks the device itself keeps moving for a visitor
// who turned motion off on the site, whether it calls matchMedia, hands GSAP's matchMedia() a
// query, or writes a style with one. So only lib/motion.ts names the device's setting, and every
// other script asks reducedMotion() there, or deviceReducesMotion() to show the device's setting
// apart from the site's, as the Reduce motion switch does. Tailwind's motion variants are media
// queries too, so their rules ask the device alone: motion rules go in components.css, in its
// motion gates (see components/motion.test.ts).
const web = fileURLToPath(new URL('../../', import.meta.url))

// What the scan reads: the app's own scripts and stylesheets, everything in src but the tests,
// which never ship, and src/prototype, the development-only design prototypes (see main.tsx).
const appFiles = readdirSync(join(web, 'src'), { encoding: 'utf8', recursive: true })
  .map((path) => join('src', path))
  .filter(
    (path) =>
      /\.(tsx?|css)$/.test(path) &&
      !/\.test\.ts$/.test(path) &&
      !path.startsWith(join('src', 'prototype')),
  )

/** Each line of code that names the device's motion setting, as `file:line: code`. */
function asksDevice(text: string, file: string) {
  // Lines that start like a comment are skipped, as a comment can name the setting without asking.
  return text
    .split('\n')
    .flatMap((line, i) =>
      /^\s*(\/\/|\/?\*)/.test(line) || !line.includes('prefers-reduced-motion')
        ? []
        : [`${file}:${i + 1}: ${line.trim()}`],
    )
}
const asksDeviceIn = (file: string) => asksDevice(readFileSync(join(web, file), 'utf8'), file)

/** Each line that uses one of Tailwind's motion variants, as `file:line: text`. */
function motionVariants(text: string, file: string) {
  // Comments too: Tailwind builds the rule for a class that it finds in a comment all the same.
  return text
    .split('\n')
    .flatMap((line, i) =>
      /\bmotion-(safe|reduce):|@variant\s+motion-(safe|reduce)\b/.test(line)
        ? [`${file}:${i + 1}: ${line.trim()}`]
        : [],
    )
}
const motionVariantsIn = (file: string) =>
  motionVariants(readFileSync(join(web, file), 'utf8'), file)

// Tailwind's motion utilities hear neither the device nor the site. A class such as animate-… or
// transition brings a rule that Tailwind writes into the site's CSS as it builds, outside every
// motion gate, where components/motion.test.ts, which reads the stylesheets as they are written,
// never sees it. An inline style can't sit in a gate either, as it holds no media query: a
// transition or an animation set in a style prop runs whatever the device or the site asks. So the
// markup leaves motion to components.css, whose gates can hold it.
//
// The utilities, read at the start of a class name or of the part after its variants, such as
// hover: or md:, and negative or not: animate-…; transition and transition-…; duration-…, which on
// its own makes every change a transition, as transition-property is all until a rule says
// otherwise; smooth scrolling; and translate-…, rotate-…, scale-… and skew-…, which place, turn,
// size or slant the element, so that under a variant such as hover: they move it. Each is written
// in pieces, so that Tailwind builds no rule for it should it read this file again
// (styles/index.css keeps the tests out of what it reads).
const MOTION_UTILITY = new RegExp(
  `(^|:)!?-?(${[
    'anim' + 'ate-',
    'trans' + 'ition(-|!?$)',
    'dura' + 'tion-',
    'scroll-' + 'smooth',
    '(trans' + 'late|ro' + 'tate|sc' + 'ale|sk' + 'ew)-',
  ].join('|')})`,
)

// The style properties that animate or glide: transition, animation and their longhands, such as
// animationDelay, and scroll-behavior, each also with a browser's prefix, such as WebkitTransition,
// or written as in CSS, such as 'transition-duration'.
const MOTION_STYLE = /^(-?(webkit|moz|ms|o)-?)?(transition|animation|scroll-?behavior)/i

/** A class name or style property that markup sets, with the `file:line` it is set on. */
type Found = { at: string; name: string }

/**
 * The class names and style properties that a file's markup sets. In a script, the class names are
 * the words of every string in an attribute whose name says class, such as className, and the
 * style properties are the property names of every object in a style attribute. A name in either
 * is followed, once, to what the file sets it to, as with Strip's row: className={row}, where
 * const row = grid ? '…' : '…'. TypeScript's own parser reads the script, so nothing else counts:
 * not a comment, not the page's text, and not a string that the markup doesn't use, such as a
 * sample's studio, Kyoto Animation. In index.html, they are the words of a class attribute and the
 * properties of a style attribute; in a stylesheet, the class names after @apply, whose rules
 * Tailwind copies in.
 */
function markup(text: string, file: string) {
  const classNames: Found[] = []
  const styles: Found[] = []
  const at = (index: number) => `${file}:${text.slice(0, index).split('\n').length}`
  if (file.endsWith('.css')) {
    // Comments are blanked out, with their line breaks kept, so the lines still count.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    for (const match of code.matchAll(/@apply\s([^;{}]*)/g))
      for (const name of match[1].split(/\s+/))
        if (name && name !== '!important') classNames.push({ at: at(match.index), name })
  } else if (file.endsWith('.html')) {
    for (const match of text.matchAll(/(?<=\s)(class|style)\s*=\s*"([^"]*)"/g)) {
      const isClass = match[1] === 'class'
      const names = isClass ? match[2].split(/\s+/) : (match[2].match(/[\w-]+(?=\s*:)/g) ?? [])
      for (const name of names)
        if (name) (isClass ? classNames : styles).push({ at: at(match.index), name })
    }
  } else {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
    // What the file sets each name to, and every attribute in its markup.
    const setTo = new Map<string, ts.Node[]>()
    const attributes: ts.JsxAttribute[] = []
    source.forEachChild(function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        setTo.set(node.name.text, [...(setTo.get(node.name.text) ?? []), node.initializer])
      else if (ts.isJsxAttribute(node)) attributes.push(node)
      node.forEachChild(visit)
    })
    for (const { name, initializer } of attributes) {
      const isClass = /class/i.test(name.getText(source))
      if (!initializer || !(isClass || name.getText(source) === 'style')) continue
      const read = (node: ts.Node, follow: boolean): void => {
        if (isClass && (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)))
          for (const word of node.text.split(/\s+/))
            if (word) classNames.push({ at: at(node.getStart(source)), name: word })
        if (!isClass && (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)))
          styles.push({
            at: at(node.getStart(source)),
            name:
              ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
                ? node.name.text
                : node.name.getText(source),
          })
        // A name, but not the property of an object, as key is in rarity.key.
        if (
          follow &&
          ts.isIdentifier(node) &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        )
          for (const value of setTo.get(node.text) ?? []) read(value, false)
        node.forEachChild((child) => read(child, follow))
      }
      read(initializer, true)
    }
  }
  return { classNames, styles }
}

test('the scan finds a script asking the device, and a motion variant, however each is written', () => {
  // matchMedia with the query written in, or in double quotes through window; a query kept in a
  // constant for matchMedia further on; and GSAP's matchMedia().add(), which takes one too. Then
  // lines the scan must pass over: comments naming the setting, and asking reducedMotion().
  const asking = [
    "const still = matchMedia('(prefers-reduced-motion: reduce)').matches",
    'if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches) start()',
    "const QUERY = '(prefers-reduced-motion: reduce)'",
    'mm.add(`(prefers-reduced-motion: no-preference)`, () => slam())',
  ]
  const notAsking = [
    '// Hears prefers-reduced-motion and the site alike',
    ' * prefers-reduced-motion, in a comment',
    'if (reducedMotion()) return',
  ]
  assert.deepEqual(
    asksDevice([...asking, ...notAsking].join('\n'), 'planted.ts'),
    asking.map((line, i) => `planted.ts:${i + 1}: ${line}`),
  )
  // A variant on a class, then in a stylesheet with @apply and @variant. The classes are made up:
  // should Tailwind read this file again, a real one would put its rule in the site's CSS.
  const variants = [
    '<span className="ab-capsule motion-safe:ab-pop" />',
    '<p className="motion-reduce:ab-still">',
    '@apply motion-safe:ab-pop;',
    '@variant motion-reduce {',
  ]
  assert.deepEqual(
    motionVariants([...variants, '<span className="ab-capsule" />'].join('\n'), 'planted.tsx'),
    variants.map((line, i) => `planted.tsx:${i + 1}: ${line}`),
  )
})

test('only lib/motion.ts asks the device about motion: every other script asks lib/motion.ts', () => {
  // So that a broken reading can't pass by finding nothing, it must read the app's scripts and
  // stylesheets, and find the question in lib/motion.ts.
  for (const file of [
    'src/main.tsx',
    'src/features/mood/PullMachine.tsx',
    'src/components/components.css',
  ])
    assert.ok(appFiles.includes(file), `the scan misses ${file}`)
  assert.ok(
    asksDeviceIn('src/lib/motion.ts').length > 0,
    'the scan misses lib/motion.ts’s question',
  )
  assert.deepEqual(
    appFiles
      .filter((file) => /\.tsx?$/.test(file) && file !== 'src/lib/motion.ts')
      .flatMap(asksDeviceIn),
    [],
    'these lines ask the device about motion themselves, so the site’s own setting can’t reach them: ask reducedMotion() from lib/motion.ts instead (or deviceReducesMotion(), for the device’s setting alone)',
  )
})

test('nothing in the app uses Tailwind’s motion variants, which only the device can turn on or off', () => {
  assert.deepEqual(
    appFiles.flatMap(motionVariantsIn),
    [],
    'these lines use Tailwind’s motion variants, which ask the device alone: write the rule in a motion gate in components.css, with the others',
  )
})

/**
 * The names found that a pattern matches, as `file:line: name`, each once: Strip's row is named by
 * two classNames, so its constant is read twice.
 */
const matching = (found: Found[], pattern: RegExp) => [
  ...new Set(
    found.filter(({ name }) => pattern.test(name)).map(({ at, name }) => `${at}: ${name}`),
  ),
]

test('the markup scan finds a motion utility in a class name, and motion in a style prop, wherever each is set', () => {
  // Each utility here is written in pieces, as in MOTION_UTILITY: should Tailwind read this file
  // again, a whole one would put its rule in the site's CSS.
  const [bounce, spin, slide, lift, grow, tilt, glide, wait, inked] = [
    ['anim', 'ate-bounce'],
    ['!anim', 'ate-spin'],
    ['trans', 'ition-transform'],
    ['hover:-trans', 'late-y-1'],
    ['group-hover:sc', 'ale-105'],
    ['[&>svg]:ro', 'tate-3'],
    ['scroll-', 'smooth'],
    ['dura', 'tion-300'],
    ['ab-ro', 'tate-3'],
  ].map((pieces) => pieces.join(''))
  // In a script, the class names: one in quotes; two beside an ab- class; one in a template, and
  // two more in it under a condition; one in a constant that a className names; and one in a prop
  // whose name says class. The style props: the shorthand; smooth scrolling, in a constant that a
  // style names; and longhands, in an object of several lines. Then what the scan passes over: a
  // comment, the page's text, an ab- class whose name holds a utility's, a string the markup
  // doesn't use, an event, and a custom property.
  const script = [
    `const row = grid ? 'ab-strip-row' : 'ab-strip-row ${glide}'`,
    `const still = { scrollBehavior: 'smooth' }`,
    `const studio = 'Kyoto Animation, a transition'`,
    `export const Page = () => (`,
    `  <section className="${bounce}">`,
    `    <span className="ab-chip ${slide} ${lift}" style={{ transition: 'transform 0.3s' }} />`,
    `    <li className={\`ab-panel ${wait} \${on ? '${grow} ${spin}' : ''}\`} />`,
    `    <ol className={row} style={still} />`,
    `    <Strip rowClassName="${tilt}" />`,
    `    <li`,
    `      style={{`,
    `        ...accentVars(color),`,
    `        animationDelay: '1s',`,
    `        WebkitTransition: 'none',`,
    `      }}`,
    `    />`,
    `    {/* <p className="${bounce}"> */}`,
    `    <p>Toei Animation’s transition, {studio}</p>`,
    `    <span className="ab-chip sr-only ${inked}" onTransitionEnd={done} style={cssVars({ '--i': i })} />`,
    `  </section>`,
    `)`,
  ].join('\n')
  // In index.html, a class and a style attribute; in a stylesheet, @apply, but not in a comment.
  const page = [`<html lang="en" class="${glide}">`, '  <body style="animation: ab-pop 1s">'].join(
    '\n',
  )
  const stylesheet = [
    '.ab-foot p {',
    `  @apply ${bounce} sr-only;`,
    '  transition: opacity 0.2s;',
    '}',
    `/* @apply ${spin}; */`,
  ].join('\n')
  const read = [
    markup(script, 'planted.tsx'),
    markup(page, 'planted.html'),
    markup(stylesheet, 'planted.css'),
  ]
  assert.deepEqual(
    {
      classNames: matching(
        read.flatMap(({ classNames }) => classNames),
        MOTION_UTILITY,
      ),
      styles: matching(
        read.flatMap(({ styles }) => styles),
        MOTION_STYLE,
      ),
    },
    {
      classNames: [
        `planted.tsx:5: ${bounce}`,
        `planted.tsx:6: ${slide}`,
        `planted.tsx:6: ${lift}`,
        `planted.tsx:7: ${wait}`,
        `planted.tsx:7: ${grow}`,
        `planted.tsx:7: ${spin}`,
        `planted.tsx:1: ${glide}`,
        `planted.tsx:9: ${tilt}`,
        `planted.html:1: ${glide}`,
        `planted.css:2: ${bounce}`,
      ],
      styles: [
        'planted.tsx:6: transition',
        'planted.tsx:2: scrollBehavior',
        'planted.tsx:13: animationDelay',
        'planted.tsx:14: WebkitTransition',
        'planted.html:2: animation',
      ],
    },
  )
})

// What the markup scan reads: the app's scripts and stylesheets, as above, and index.html, the
// page they load into.
const appMarkup = ['index.html', ...appFiles].map((file) =>
  markup(readFileSync(join(web, file), 'utf8'), file),
)

test('no class name in the app uses Tailwind’s motion utilities, whose rules no motion gate holds', () => {
  const classNames = appMarkup.flatMap((found) => found.classNames)
  // So that a broken reading can't pass by finding nothing, it must read the switch's class names,
  // and the row's, which Strip keeps in a constant.
  for (const [file, name] of [
    ['src/components/MotionSwitch.tsx', 'ab-switch'],
    ['src/components/Strip.tsx', 'ab-strip-grid'],
  ])
    assert.ok(
      classNames.some((found) => found.at.startsWith(`${file}:`) && found.name === name),
      `the scan misses ${name} in ${file}`,
    )
  assert.deepEqual(
    matching(classNames, MOTION_UTILITY),
    [],
    'these class names use Tailwind’s motion utilities, whose rules Tailwind writes outside every motion gate, where neither the device’s setting nor the site’s can stop them: give the element an ab- class, and its motion a rule in a motion gate in components.css',
  )
})

test('no style prop sets a transition, an animation or scroll-behavior, which no motion gate can hold', () => {
  const styles = appMarkup.flatMap((found) => found.styles)
  // So that a broken reading can't pass by finding nothing, it must read Strip's style, which sets
  // a custom property, --i.
  assert.ok(
    styles.some(
      (found) => found.at.startsWith('src/components/Strip.tsx:') && found.name === '--i',
    ),
    'the scan misses the --i in Strip’s style',
  )
  assert.deepEqual(
    matching(styles, MOTION_STYLE),
    [],
    'these style props set a transition, an animation or scroll-behavior, which an inline style can’t put in a motion gate, so neither the device’s setting nor the site’s can stop it: give the element an ab- class, and its motion a rule in a motion gate in components.css',
  )
})

// A script that moves something itself, with the Web Animations API (element.animate), plays
// whatever the stylesheet's motion gates say: so it asks reducedMotion() first, in the same file,
// before the call. Each call to .animate( in a file with no reducedMotion() call before it, as
// `file:line: code`; lines that start like a comment are skipped.
function animatesUnasked(text: string, file: string) {
  const lines = text.split('\n')
  const asked = lines.findIndex(
    (line) => !/^\s*(\/\/|\/?\*)/.test(line) && /\breducedMotion\(\)/.test(line),
  )
  return lines.flatMap((line, i) =>
    /^\s*(\/\/|\/?\*)/.test(line) || !/\.animate\(/.test(line) || (asked !== -1 && asked < i)
      ? []
      : [`${file}:${i + 1}: ${line.trim()}`],
  )
}

test('the scan finds a script that animates without asking reducedMotion() first, however it is laid out', () => {
  assert.deepEqual(animatesUnasked('el.animate(frames, timing)', 'a.ts'), [
    'a.ts:1: el.animate(frames, timing)',
  ])
  assert.deepEqual(
    animatesUnasked('chip.animate(a)\nif (reducedMotion()) return\npill.animate(b)', 'b.ts'),
    ['b.ts:1: chip.animate(a)'],
  )
  assert.deepEqual(animatesUnasked('if (reducedMotion()) return\nel.animate(frames)', 'c.ts'), [])
  // A comment naming either asks nothing and animates nothing.
  assert.deepEqual(animatesUnasked('// reducedMotion()\nel.animate(frames)', 'd.ts'), [
    'd.ts:2: el.animate(frames)',
  ])
  assert.deepEqual(animatesUnasked('// then el.animate(frames)', 'e.ts'), [])
})

test('every script that animates with element.animate asks reducedMotion() first', () => {
  // So that a broken reading can't pass by finding nothing, it must find the flight's animations.
  const animating = appFiles.filter(
    (file) => /\.tsx?$/.test(file) && /\.animate\(/.test(readFileSync(join(web, file), 'utf8')),
  )
  assert.ok(
    animating.includes('src/lib/sectionNav.ts'),
    'the scan misses the section links’ flight',
  )
  assert.deepEqual(
    animating.flatMap((file) => animatesUnasked(readFileSync(join(web, file), 'utf8'), file)),
    [],
    'these lines animate before their file asks reducedMotion(): ask it first, and swap at once under reduced motion',
  )
})
