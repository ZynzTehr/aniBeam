import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contrast, toHex, toOklch, type Oklch } from './color.ts'

test('black on white is 21:1, and a color on itself is 1:1', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21)
  assert.equal(contrast('#ff2d55', '#ff2d55'), 1)
})

test('contrast matches the ratios WebAIM publishes', () => {
  // #767676 is the lightest gray that passes 4.5:1 on white; pure red only reaches 4:1.
  assert.equal(contrast('#767676', '#ffffff').toFixed(2), '4.54')
  assert.equal(contrast('#0000ff', '#ffffff').toFixed(2), '8.59')
  assert.equal(contrast('#ff0000', '#ffffff').toFixed(2), '4.00')
})

test('contrast is the same in either order', () => {
  assert.equal(contrast('#ffffff', '#767676'), contrast('#767676', '#ffffff'))
})

test('toOklch gives the published OKLCH values for red and blue', () => {
  const round = ({ l, c, h }: Oklch) => ({ l: +l.toFixed(3), c: +c.toFixed(3), h: +h.toFixed(1) })
  assert.deepEqual(round(toOklch('#ff0000')), { l: 0.628, c: 0.258, h: 29.2 })
  assert.deepEqual(round(toOklch('#0000ff')), { l: 0.452, c: 0.313, h: 264.1 })
})

// Every 15th value of each channel: 18 x 18 x 18 = 5,832 colors from black to white.
const levels = Array.from({ length: 18 }, (_, i) => (i * 15).toString(16).padStart(2, '0'))
const sample = levels.flatMap((r) => levels.flatMap((g) => levels.map((b) => `#${r}${g}${b}`)))

test('toHex turns toOklch back into the same color', () => {
  for (const hex of sample) assert.equal(toHex(toOklch(hex)), hex)
})

test('toHex gives up chroma, not lightness or hue, for a color outside sRGB', () => {
  const { l, c, h } = toOklch(toHex({ l: 0.9, c: 0.3, h: 260 }))
  assert.ok(Math.abs(l - 0.9) < 0.005, `lightness ${l}`)
  assert.ok(Math.abs(h - 260) < 2, `hue ${h}`)
  assert.ok(c < 0.3, `chroma ${c}`)
})
