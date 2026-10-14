import { readdirSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Spec §3J: visitors who ask for reduced motion get no sliding, zooming or swinging. Motion
// lives only inside @media (prefers-reduced-motion: no-preference) blocks; outside them,
// styles may change color, shadow and opacity but never animate movement. Every stylesheet in
// src is read as one, not only components.css: index.css holds the rules for the whole page, as
// smooth scrolling on html would be, and a component can bring a stylesheet of its own, which
// ships with the rest. The development-only design prototypes in src/prototype never ship (see
// main.tsx), so their stylesheets are left out.
const web = fileURLToPath(new URL('../../', import.meta.url))
const stylesheets = readdirSync(join(web, 'src'), { encoding: 'utf8', recursive: true })
  .map((path) => join('src', path))
  .filter((path) => path.endsWith('.css') && !path.startsWith(join('src', 'prototype')))
  .sort()
const css = stylesheets
  .map((path) => readFileSync(join(web, path), 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** The stylesheet with every no-preference block cut out: what reduced-motion visitors get. */
function calmCss(text: string) {
  const gate = '@media (prefers-reduced-motion: no-preference)'
  let calm = ''
  let from = 0
  for (let at = text.indexOf(gate); at !== -1; at = text.indexOf(gate, from)) {
    calm += text.slice(from, at)
    let depth = 0
    let end = text.indexOf('{', at)
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}' && --depth === 0) break
    }
    from = end + 1
  }
  return calm + text.slice(from)
}
const calm = calmCss(css)

/**
 * Each declaration in the text, with the selector (or at-rule) of the block it sits in, and those
 * of every block it sits in, outermost first.
 */
function declarations(text: string) {
  const found: { rule: string; within: string[]; property: string; value: string }[] = []
  const open: string[] = []
  let from = 0
  for (const match of text.matchAll(/[{};]/g)) {
    const chunk = text.slice(from, match.index).replace(/\s+/g, ' ').trim()
    from = match.index + 1
    if (match[0] === '{') {
      open.push(chunk)
      continue
    }
    const [, property, value] = /^([\w-]+)\s*:\s*(.*)$/.exec(chunk) ?? []
    if (property) found.push({ rule: open.at(-1) ?? '', within: [...open], property, value })
    if (match[0] === '}') open.pop()
  }
  return found
}

test('the check sees every stylesheet and the motion gates', () => {
  // So that a broken listing can't pass by reading less, it must find components.css and index.css.
  for (const file of ['src/components/components.css', 'src/styles/index.css'])
    assert.ok(stylesheets.includes(file), `the check misses ${file}`)
  assert.ok(css.length > 10_000 && calm.length < css.length)
})

// The properties that move a box or change its size: transform, and translate, rotate and scale,
// each of which does one of its jobs on its own; any width or height, such as max-width or
// border-width, and their logical names, inline-size and block-size; the box's place, set by top,
// right, bottom, left and inset; and its margins, which push it and the boxes beside it. all is
// every property. Longhands and prefixed names count too, such as margin-left,
// inset-inline-start, transform-origin and -webkit-transform; border-left-color, a color, doesn't.
const MOVING =
  /^(-\w+-)?(all|transform(-[\w-]+)?|translate|rotate|scale|([\w-]+-)?(width|height)|((min|max)-)?(inline|block)-size|top|right|bottom|left|(inset|margin)(-[\w-]+)?)$/

test('outside the motion gate, no transition moves or resizes anything', () => {
  const moving = [...calm.matchAll(/transition(?:-property)?\s*:([^;}]*)/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .filter((value) => value.match(/[\w-]+/g)?.some((word) => MOVING.test(word)))
  assert.deepEqual(moving, [])
})

test('outside the motion gate, hovering or pressing never moves anything', () => {
  const moves = [...calm.matchAll(/([^{}]*:(?:hover|active)[^{}]*)\{([^{}]*)\}/g)].flatMap(
    ([, selector, body]) =>
      body
        .split(';')
        .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
        .filter((declaration) => MOVING.test(declaration.split(':')[0].trim()))
        .map((declaration) => `${selector.replace(/\s+/g, ' ').trim()} { ${declaration} }`),
  )
  assert.deepEqual(moves, [])
})

// Spec §3J: with reduced motion, the title card comes in with a 150 ms cross-fade, and goes with
// one. A fade moves nothing, so it may run outside the gate, if it is that quick and plays once:
// one that repeats would blink.
const FADE_MS = 150

/** A CSS time, such as 0.15s or 150ms, in milliseconds; undefined for anything else. */
const msOf = (word: string) => {
  const time = /^(-?\d*\.?\d+)(m?s)$/i.exec(word.trim())
  return time ? Number(time[1]) * (time[2].toLowerCase() === 's' ? 1000 : 1) : undefined
}

// The words the animation shorthand can hold besides names, times and counts.
const KEYWORDS =
  /^((cubic-bezier|steps|linear)\(.*\)|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|reverse|alternate|alternate-reverse|none|forwards|backwards|both|running|paused)$/i

/**
 * What makes an animation shorthand's value more than a quick fade, for each animation it names:
 * what its keyframes change besides opacity, a duration over FADE_MS, and a count other than
 * once. '' when each one is a quick fade, or it names none.
 */
function notAFade(value: string) {
  const reasons: string[] = []
  // The animations a comma separates, each in words; a function such as
  // cubic-bezier(0.2, 0.8, 0.2, 1) is one word.
  for (const animation of value.replace(/\s*!important$/i, '').split(/,(?![^(]*\))/)) {
    let ms: number | undefined
    let times = 1
    const names: string[] = []
    for (const word of animation.match(/[\w-]+\([^)]*\)|\S+/g) ?? []) {
      // The first time is the duration; the second, the delay, moves nothing.
      if (msOf(word) !== undefined) ms ??= msOf(word)
      else if (/^(\d*\.?\d+|infinite)$/i.test(word))
        times = /infinite/i.test(word) ? Infinity : Number(word)
      else if (word.includes('(') && !KEYWORDS.test(word))
        reasons.push(`this check can't read ${word}`)
      else if (!KEYWORDS.test(word)) names.push(word)
    }
    for (const name of names) {
      const changes = new Set(
        declarations(css)
          .filter(({ within }) => within.includes(`@keyframes ${name}`))
          .map(({ property }) => property),
      )
      if (!changes.size) reasons.push(`no @keyframes ${name} says what it changes`)
      changes.delete('opacity')
      if (changes.size) reasons.push(`${name} changes ${[...changes].join(' and ')}`)
      if ((ms ?? 0) > FADE_MS) reasons.push(`it runs ${ms} ms`)
      if (times !== 1)
        reasons.push(times === Infinity ? 'it repeats forever' : `it runs ${times} times`)
    }
  }
  return reasons.join('; ')
}

test('the fade check reads what an animation changes, how long it runs and how often', () => {
  // A reading that misses a duration, a count or a name would pass any animation, so it is read
  // here on the title card's own fade and the pop's keyframes, as rules outside the gate could
  // name them.
  const values = [
    'ab-fade 0.15s linear',
    'ab-fade 150ms',
    'none',
    'ab-fade 0.2s linear 0.1s',
    'ab-fade 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) infinite',
    'ab-fade 0.15s linear 2 alternate',
    'ab-fade 0.15s, ab-pop 0.1s both',
    'ab-fade var(--fade)',
    'ab-faded 0.15s',
  ]
  assert.deepEqual(Object.fromEntries(values.map((value) => [value, notAFade(value)])), {
    'ab-fade 0.15s linear': '',
    'ab-fade 150ms': '',
    none: '',
    'ab-fade 0.2s linear 0.1s': 'it runs 200 ms',
    'ab-fade 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) infinite': 'it repeats forever',
    'ab-fade 0.15s linear 2 alternate': 'it runs 2 times',
    'ab-fade 0.15s, ab-pop 0.1s both': 'ab-pop changes transform',
    'ab-fade var(--fade)': "this check can't read var(--fade)",
    'ab-faded 0.15s': 'no @keyframes ab-faded says what it changes',
  })
})

test('outside the motion gate, nothing animates but a fade of 150 ms or less, and nothing scrolls smoothly', () => {
  // The @keyframes sit outside the gate and do nothing until a rule names them, so that rule
  // belongs inside it, unless it is a quick fade (see FADE_MS). Only the animation shorthand
  // says what plays, how long and how often, all at once, so a fade outside uses it, and no
  // longhand there may name an animation, lengthen one or repeat it. The timelines that tie an
  // animation to scrolling (the splash parallax's) belong inside too, and so does smooth
  // scrolling, which glides the page to wherever a link or a script sends it. animation: none
  // stops one, so it may stay outside.
  const moving = declarations(calm).flatMap(({ rule, property, value }) => {
    const each = value
      .replace(/\s*!important$/i, '')
      .split(/,(?![^(]*\))/)
      .map((part) => part.trim())
    let why = ''
    if (property === 'animation') why = notAFade(value)
    else if (property === 'animation-name' && each.some((name) => !/^none$/i.test(name)))
      why = 'a longhand, which says neither how long nor how often'
    else if (
      property === 'animation-duration' &&
      each.some((time) => (msOf(time) ?? Infinity) > FADE_MS)
    )
      why = `longer than ${FADE_MS} ms`
    else if (property === 'animation-iteration-count' && each.some((count) => count !== '1'))
      why = 'it repeats'
    else if (property === 'scroll-behavior' && /^smooth/i.test(value)) why = 'it glides the page'
    else if (/^(animation|view|scroll)-timeline/.test(property)) why = 'tied to scrolling'
    return why ? [`${rule} { ${property}: ${value} }: ${why}`] : []
  })
  assert.deepEqual(
    moving,
    [],
    `these rules animate or scroll outside the gate, where only a fade may run (spec §3J): the animation shorthand, naming keyframes that change opacity alone, played once, in ${FADE_MS} ms or less. Put them in the gate`,
  )
})

test('outside the motion gate, nothing pauses an animation', () => {
  // A paused animation holds its frame for as long as it stays paused. Outside the gate, what
  // plays is a quick fade (see FADE_MS), the title card's. Its fade in starts see-through: held
  // there, the card never shows to visitors who reduce motion. Held, its fade out never ends, and
  // the card closes only once it has. A rule that pauses every animation while the site is set to
  // reduce motion, to keep the page still, does both. So outside the gate, the animation
  // shorthand never says paused, and animation-play-state says only running, as a value this
  // check can't read, such as var(), could pause too. Prefixed names count as well. In the gate,
  // a pause can hold only motion, which plays nowhere else.
  const pausing = declarations(calm).flatMap(({ rule, property, value }) => {
    const name = property.replace(/^-\w+-/, '')
    const words = value.replace(/\s*!important$/i, '').split(/[\s,]+/)
    const pauses =
      name === 'animation'
        ? words.some((word) => /^paused$/i.test(word))
        : name === 'animation-play-state' && words.some((word) => !/^running$/i.test(word))
    return pauses ? [`${rule} { ${property}: ${value} }`] : []
  })
  assert.deepEqual(
    pausing,
    [],
    'these rules pause an animation outside the gate, or may: the title card’s fade in would hold its see-through first frame, and the card never show to visitors who reduce motion, and its fade out would never end, and the card never close. Take the pause out',
  )
})

// Visitors can also ask for reduced motion on the site itself. Its Reduce motion switch sets
// data-motion="reduce" on <html> (see lib/motion.ts), which a media query can't see. So inside
// each gate, the rules sit in one more rule, which holds only while the switch is off. :where()
// adds no specificity, so every rule inside keeps its rank; a bare :root:not() would add two
// classes to each.
const SWITCH = ":where(:root:not([data-motion='reduce']))"

/**
 * What sits directly inside each motion gate, gate by gate: each rule's selector (or at-rule), and
 * any declaration left loose in the gate itself.
 */
function gateContents(text: string) {
  const gate = '@media (prefers-reduced-motion: no-preference)'
  const gates: string[][] = []
  for (let at = text.indexOf(gate); at !== -1; at = text.indexOf(gate, at + 1)) {
    const inside: string[] = []
    let depth = 0
    let from = text.indexOf('{', at) + 1
    // Up to the brace that closes the gate, which takes the depth below 0.
    for (let i = from; i < text.length && depth >= 0; i++) {
      if (!'{};'.includes(text[i])) continue
      const chunk = text.slice(from, i).replace(/\s+/g, ' ').trim()
      if (depth === 0 && chunk) inside.push(chunk)
      depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0
      from = i + 1
    }
    gates.push(inside)
  }
  return gates
}

test('every motion gate honors the switch', () => {
  const gates = gateContents(css)
  // Every gate holds a rule, so a gate read as empty means this reading is broken.
  assert.ok(
    gates.length > 0 && gates.every((inside) => inside.length > 0),
    'the check found no rules in the motion gates',
  )
  const honoring = gates.filter((inside) => inside.every((item) => item === SWITCH)).length
  assert.deepEqual(
    gates.flatMap((inside, i) =>
      inside.filter((item) => item !== SWITCH).map((item) => `gate ${i + 1}: ${item}`),
    ),
    [],
    `${honoring} of ${gates.length} motion gates honor the switch: these rules sit in a gate but outside ${SWITCH} { … }, so the site’s own setting, data-motion="reduce" on <html>, can’t stop them`,
  )

  // The :where() rule matches <html> itself, and a rule nested in it without & reads as one for
  // what lies inside <html>. So html { … } or :root { … } there, as smooth scrolling might be
  // written, looks for an <html> inside <html> and never applies, and nothing says so. What
  // <html> itself gets goes in & { … }, the one form this takes: any rule there that names html
  // or :root fails, even &:root, which does reach <html>.
  const wrapped = declarations(css).filter(({ within }) => within.includes(SWITCH))
  assert.ok(wrapped.length > 0, `the check found no rules in ${SWITCH}`)
  // html as a tag, not as part of a name such as .ab-html.
  const root = /(?<![\w.#:-])html(?![\w-])|:root(?![\w-])/i
  assert.deepEqual(
    wrapped.flatMap(({ within, property, value }) => {
      const nested = within.slice(within.indexOf(SWITCH) + 1)
      return nested.some((prelude) => !prelude.startsWith('@') && root.test(prelude))
        ? [[...nested, `${property}: ${value}`].join(' { ') + ' }'.repeat(nested.length)]
        : []
    }),
    [],
    `these rules sit in ${SWITCH} { … } and name html or :root: that rule matches <html>, and nested in it, html { … } or :root { … } looks for an <html> inside <html>, so it never applies. Write what <html> itself gets in & { … } there`,
  )
})

test('nothing depends on reduce alone', () => {
  // The switch can stop what a gate holds, but it can't turn on a rule for reduced motion: one
  // under @media (prefers-reduced-motion: reduce), or the bare (prefers-reduced-motion), which
  // asks the same, holds only while the device asks. So the calm look is every rule's default,
  // what motion adds sits in a gate, and the gate, written just so, is the one place that asks
  // the device: motion that needs another condition, such as a width, nests it inside.
  const gate = '@media (prefers-reduced-motion: no-preference)'
  const asks = (prelude: string) => /prefers-reduced-motion/i.test(prelude)
  const asking = declarations(css).filter(({ within }) => within.some(asks))
  // The gates' own rules ask too, so a reading that finds none of them is broken.
  assert.ok(
    asking.some(({ within }) => within.includes(gate)),
    'the check found no rules in the motion gates',
  )
  assert.deepEqual(
    asking
      .filter(({ within }) => within.some((prelude) => asks(prelude) && prelude !== gate))
      .map(
        ({ within, property, value }) =>
          [...within, `${property}: ${value}`].join(' { ') + ' }'.repeat(within.length),
      ),
    [],
    `these rules ask the device about motion outside the gate, ${gate}, and a media query never hears the site’s own setting, data-motion="reduce" on <html>: make the calm look the default, and put what motion adds in a gate`,
  )
})
