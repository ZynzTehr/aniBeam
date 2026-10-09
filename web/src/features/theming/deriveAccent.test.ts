import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contrast, toOklch } from '../../lib/color.ts'
import { accentVars, deriveAccent } from './deriveAccent.ts'

// The backgrounds as literals, so a wrong constant in the code can't hide here too.
const INK = '#141414'
const DOTTED_PAPER = '#e5e0d6' // the page's darkest pixel: paper under a 7% black dot
const PAPER = '#f6f1e6'
const WHITE = '#ffffff'

// Every 15th value of each channel: 18 x 18 x 18 = 5,832 colors from black to white,
// derived once for the tests below.
const levels = Array.from({ length: 18 }, (_, i) => (i * 15).toString(16).padStart(2, '0'))
const derived = levels.flatMap((r) =>
  levels.flatMap((g) =>
    levels.map((b) => {
      const color = `#${r}${g}${b}`
      return { color, ...deriveAccent(color) }
    }),
  ),
)
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

test('every fill reads at 4.5:1 against ink, so ink outlines, text and labels work on it', () => {
  for (const { color, accent } of derived) {
    assert.match(accent, /^#[0-9a-f]{6}$/)
    assert.ok(contrast(accent, INK) >= 4.5, `${color} -> ${accent}`)
  }
})

test('every text color reads at 4.5:1 on the dotted page, paper and white', () => {
  for (const { color, text } of derived) {
    assert.match(text, /^#[0-9a-f]{6}$/)
    for (const background of [DOTTED_PAPER, PAPER, WHITE])
      assert.ok(contrast(text, background) >= 4.5, `${color} -> ${text} on ${background}`)
  }
})

test('a color that had to move moves no further than needed', () => {
  for (const { color, accent, text } of derived) {
    const { l, c } = toOklch(color)
    if (c < 0.12 || c > 0.24) continue // these also change chroma, which moves contrast
    if (contrast(color, DOTTED_PAPER) < 4.5)
      assert.ok(contrast(text, DOTTED_PAPER) < 4.6, `${color} -> text ${text}`)
    if (l >= 0.6 && l <= 0.85 && contrast(color, INK) < 4.5)
      assert.ok(contrast(accent, INK) < 4.6, `${color} -> fill ${accent}`)
  }
})

test('a cover color that already works is kept', () => {
  assert.equal(deriveAccent('#e45d5d').accent, '#e45d5d') // a mid red is already a good fill
  assert.equal(deriveAccent('#1a3a8f').text, '#1a3a8f') // a dark navy already reads on paper
})

test('keeps the hue of the cover color', () => {
  for (const { color, accent, text } of derived) {
    const input = toOklch(color)
    if (input.c < 0.05) continue // nearly gray: no hue worth keeping
    for (const output of [accent, text].map(toOklch)) {
      if (output.c < 0.05) continue
      assert.ok(hueGap(output.h, input.h) <= 2, `${color}: hue ${input.h} -> ${output.h}`)
    }
  }
})

test('grays stay exactly gray', () => {
  for (let v = 0; v < 256; v++) {
    const gray = `#${v.toString(16).padStart(2, '0').repeat(3)}`
    for (const hex of Object.values(deriveAccent(gray)))
      assert.ok(
        hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5),
        `${gray} -> ${hex}`,
      )
  }
})

test('nothing comes out more saturated than brand hot', () => {
  for (const { color, accent, text } of derived)
    for (const hex of [accent, text]) assert.ok(toOklch(hex).c <= 0.245, `${color} -> ${hex}`)
})

test('fills stay mid to light, so they neither muddy the ink nor fade into the paper', () => {
  for (const { color, accent } of derived) {
    const { l } = toOklch(accent)
    assert.ok(l >= 0.595 && l <= 0.855, `${color} -> ${accent} (lightness ${l})`)
  }
})

test('a pale cover still gives a colorful fill', () => {
  // #f1c9ae, a pale peach with chroma 0.058, gets about twice that, as far as sRGB allows.
  assert.ok(toOklch(deriveAccent('#f1c9ae').accent).c > 0.09)
})

test('a missing or malformed color falls back to brand hot', () => {
  // Hot works as a fill (5.05:1 on ink) but not as text (3.24:1 on paper), so text goes deeper.
  const brand = { accent: '#ff2d55', text: '#c9003a' }
  assert.deepEqual(deriveAccent(null), brand)
  const malformed = ['', 'blue', '#38e', '#3586e', '#3586e4f', '#3586e4ff', '3586e4', ' #3586e4']
  for (const color of [...malformed, '#3586e4 ', '#3586g4'])
    assert.deepEqual(deriveAccent(color), brand, JSON.stringify(color))
  // Values the types rule out but a JSON response could still carry.
  for (const color of [undefined, 42, {}] as unknown as string[])
    assert.deepEqual(deriveAccent(color), brand, String(color))
})

test('uppercase hex is read like lowercase', () => {
  assert.deepEqual(deriveAccent('#3586E4'), { accent: '#3586e4', text: '#0463be' })
})

test('pure colors, black and white come out like this', () => {
  // [cover color, fill, text]. Each line also passes every rule above.
  const cases = [
    ['#000000', '#808080', '#000000'], // black: a mid-gray fill
    ['#ffffff', '#cecece', '#636363'], // white: a light-gray fill, mid-gray text
    ['#ff0000', '#f8271c', '#cb0000'], // red: chroma capped at hot's
    ['#00ff00', '#58f351', '#007500'], // green: lighter fill, no neon; green text
    ['#0000ff', '#3b75ff', '#073bd8'], // blue: fill lightened until ink reads on it
    ['#ffff00', '#d7d700', '#676700'], // yellow: hardest on paper, its text turns olive
    ['#00ffff', '#00ebeb', '#006f6f'], // cyan: teal text
    ['#ff00ff', '#ea58e7', '#b00eb0'], // magenta: chroma capped
  ]
  for (const [color, accent, text] of cases)
    assert.deepEqual(deriveAccent(color), { accent, text }, color)
})

test('accentVars hands both colors to CSS under the token names', () => {
  assert.deepEqual(accentVars(null), {
    '--anime-accent': '#ff2d55',
    '--anime-accent-text': '#c9003a',
  })
})
