import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPlainClick } from './plainClick.ts'

const click = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }

test('a title link opens its card on a plain click, and leaves every other click to the browser', () => {
  assert.equal(isPlainClick(click), true)
  for (const [what, changed] of [
    ['Ctrl (a new tab)', { ctrlKey: true }],
    ['Cmd (a new tab on a Mac)', { metaKey: true }],
    ['Shift (a new window)', { shiftKey: true }],
    ['Alt (a download)', { altKey: true }],
    ['the middle button', { button: 1 }],
    ['the right button', { button: 2 }],
  ] as const)
    assert.equal(isPlainClick({ ...click, ...changed }), false, what)
})
