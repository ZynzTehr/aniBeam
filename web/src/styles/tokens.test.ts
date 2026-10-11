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
