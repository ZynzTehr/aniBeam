import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

// The tokens in index.css are the one place to change a color, size or spacing. A token nothing
// reads, or a component rule that copies a token's value instead of reading it, turns an edit to
// the token into one that silently does nothing.
const css = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const index = css('./index.css')
const components = css('../components/components.css')
const root = index.slice(index.indexOf(':root {'), index.indexOf('}', index.indexOf(':root {')))
const tokens = [...root.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => ({
  name,
  value: value.trim(),
}))

test('the check sees the tokens', () => {
  assert.ok(tokens.length > 15, `only ${tokens.length} tokens found`)
})

test('every design token is read somewhere', () => {
  const unread = tokens.filter(
    ({ name }) => !new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(index + components),
  )
  assert.deepEqual(
    unread.map(({ name }) => name),
    [],
  )
})

test('component CSS reads the tokens instead of copying their values', () => {
  // Plain lengths such as --gutter's 12px also turn up for other reasons; colors and clamp()s don't.
  const copied = tokens.filter(
    ({ value }) => /[#(]/.test(value) && !value.startsWith('var(') && components.includes(value),
  )
  assert.deepEqual(
    copied.map(({ name }) => name),
    [],
  )
})

test('the scroll slam’s knobs are tokens, read with no fallback, so changing one changes the slam', () => {
  // How big a landing panel starts, its tilt, and the time between parts landing together (see
  // the Landing section of components.css): the values chosen from draft #16.
  const knobs = Object.fromEntries(
    tokens.filter(({ name }) => name.startsWith('--slam-')).map(({ name, value }) => [name, value]),
  )
  assert.deepEqual(knobs, {
    '--slam-scale': '1.14',
    '--slam-tilt': '-2.5deg',
    '--slam-stagger': '90ms',
  })
  // A fallback would go on standing in, and hide a knob's name misspelt in index.css.
  assert.deepEqual(
    [...components.matchAll(/var\(\s*(--slam-[\w-]+)\s*,/g)].map(([, name]) => name),
    [],
  )
})

test('every slam knob the stylesheet reads is one index.css defines', () => {
  // A knob misspelt where it is read reads as nothing, and the slam quietly loses it there.
  const defined = new Set(tokens.map(({ name }) => name))
  const read = [...components.matchAll(/var\(\s*(--slam-[\w-]+)/g)].map(([, name]) => name)
  assert.ok(read.length >= 6, `only ${read.length} reads of a slam knob found`)
  assert.deepEqual([...new Set(read.filter((name) => !defined.has(name)))], [])
})
