import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// Spec §3J: visitors who ask for reduced motion get no sliding, zooming or swinging. Motion
// lives only inside @media (prefers-reduced-motion: no-preference) blocks; outside them,
// styles may change color, shadow and opacity but never animate movement.
const css = readFileSync(new URL('./components.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

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
