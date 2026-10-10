import assert from 'node:assert/strict'
import { test } from 'node:test'
import { searchable } from './ime.ts'

test('kana, kanji and full-width letters an input method is still converting are not searched', () => {
  // Hiragana, katakana, kanji, a compatibility kanji (as in the name 山﨑), Taiwan's zhuyin
  // and full-width letters.
  for (const text of ['しんげき', 'フリーレン', '神撃', '﨑', 'ㄓㄨ', 'ｆｒｉｅｒｅｎ'])
    assert.equal(searchable(text, true, ''), '', `${text} was searched while still converting`)
})

test('while a word is converted, the search keeps what the box held before it', () => {
  assert.equal(searchable('frieren しん', true, 'frieren '), 'frieren ')
})

test('a converted word is searched once the visitor has picked it', () => {
  assert.equal(searchable('進撃', false, ''), '進撃')
})

test('Latin letters and Korean are searched as typed, even while an input method composes them', () => {
  // Android keyboards compose every word, and Korean shows final letters as you type.
  assert.equal(searchable('frieren', true, ''), 'frieren')
  assert.equal(searchable('근은혼', true, '근은'), '근은혼')
})
