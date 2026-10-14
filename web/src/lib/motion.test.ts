import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  deviceReducesMotion,
  reducedMotion,
  savedMotionChoice,
  saveMotionChoice,
  watchDeviceMotion,
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
 * is true; and localStorage, which is what `storage()` returns, or throws. In a browser, window is
 * globalThis, so each can be read through window too. `changeDevice()` changes the device's
 * setting as a visitor would while the page is open: each media query list that matchMedia gave
 * out whose answer changes then calls its own change listeners, as a browser's does.
 */
function fakePage(t: TestContext) {
  const before = ['window', 'document', 'matchMedia', 'localStorage'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  t.after(() => {
    for (const [name, descriptor] of before)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
  })
  const storage = fakeStorage()
  // Every media query list handed out, each with the change listeners added to it alone, and
  // whether each was added to be called once only.
  const lists: { query: string; listeners: Map<() => void, boolean> }[] = []
  const page = {
    dataset: {} as DOMStringMap,
    deviceAsks: false,
    storage: (): StorageLike => storage,
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
    value: { documentElement: { dataset: page.dataset } },
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
  // A variant on a class, then in a stylesheet with @apply and @variant. Tailwind reads this file
  // for class names as well, so the classes are made up: a real one would put its rule in the
  // site's CSS.
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
