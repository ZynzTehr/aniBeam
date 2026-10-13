import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// Spec §3J: visitors who ask for reduced motion get no sliding, zooming or swinging. Motion
// lives only inside @media (prefers-reduced-motion: no-preference) blocks; outside them,
// styles may change color, shadow and opacity but never animate movement. index.css is read
// too: a rule for the whole page, such as smooth scrolling on html, would go there.
const css = ['./components.css', '../styles/index.css']
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
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

/** Each declaration in the text, with the selector (or at-rule) of the block it sits in. */
function declarations(text: string) {
  const found: { rule: string; property: string; value: string }[] = []
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
    if (property) found.push({ rule: open.at(-1) ?? '', property, value })
    if (match[0] === '}') open.pop()
  }
  return found
}

test('the check sees the stylesheet and its motion gates', () => {
  assert.ok(css.length > 10_000 && calm.length < css.length)
})

test('outside the motion gate, no transition moves or resizes anything', () => {
  const moving = [...calm.matchAll(/transition(?:-property)?\s*:([^;}]*)/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .filter((value) => /transform|\bwidth\b|\ball\b/.test(value))
  assert.deepEqual(moving, [])
})

test('outside the motion gate, hovering or pressing never moves anything', () => {
  const moves = [...calm.matchAll(/([^{}]*:(?:hover|active)[^{}]*)\{([^{}]*)\}/g)]
    .filter((match) => /\btransform\s*:/.test(match[2]))
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
  assert.deepEqual(moves, [])
})

test('outside the motion gate, nothing animates or scrolls smoothly', () => {
  // The @keyframes sit outside the gate and do nothing until a rule names them, so that rule
  // belongs inside it, whatever its keyframes change. So do the timelines that tie an animation
  // to scrolling (the splash parallax's), and smooth scrolling, which glides the page to
  // wherever a link or a script sends it. animation: none stops one, so it may stay outside.
  const moving = declarations(calm)
    .filter(({ property, value }) => {
      if (property === 'animation' || property === 'animation-name')
        return !/^none(\s*!important)?$/i.test(value)
      if (property === 'scroll-behavior') return /^smooth/i.test(value)
      return /^(animation|view|scroll)-timeline/.test(property)
    })
    .map(({ rule, property, value }) => `${rule} { ${property}: ${value} }`)
  assert.deepEqual(moving, [])
})
