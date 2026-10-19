import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmsWord, searchable } from './ime.ts'

test('kana, kanji and full-width letters an input method is still converting are not searched', () => {
  // Hiragana, katakana, kanji, a compatibility kanji (as in the name 山﨑), Taiwan's zhuyin
  // and full-width letters.
  for (const text of ['しんげき', 'フリーレン', '神撃', '﨑', 'ㄓㄨ', 'ｆｒｉｅｒｅｎ'])
    assert.equal(searchable(text, true, ''), '', `${text} was searched while still converting`)
})

test('while a word is converted, the search keeps what the box held before it', () => {
  assert.equal(searchable('frieren しん', true, 'frieren '), 'frieren ')
  // Wherever the word is typed: over the selected "frieren", or after the kana it repeats (のん,
  // then のん again for のんのんびより). Cancelling the word leaves the search as it was.
  assert.equal(searchable('しん', true, 'frieren'), 'frieren')
  assert.equal(searchable('のんのん', true, 'のん'), 'のん')
  assert.equal(searchable('frieren ', true, 'frieren '), 'frieren ')
})

test('a converted word is searched once the visitor has picked it', () => {
  assert.equal(searchable('進撃', false, ''), '進撃')
})

test('Latin letters and Korean are searched as typed, even while an input method composes them', () => {
  // Android keyboards compose every word, and Korean shows final letters as you type.
  assert.equal(searchable('frieren', true, ''), 'frieren')
  assert.equal(searchable('근은혼', true, '근은'), '근은혼')
})

test('a Latin or Korean word is searched as typed even next to a Japanese one', () => {
  // Only the word being composed counts, not the Japanese word the visitor already picked: here
  // "shippuden" (Android keyboards compose every word) and a Korean syllable after ナルト, and
  // "boruto" typed in front of it.
  for (const [text, before] of [
    ['ナルト shippuden', 'ナルト '],
    ['ナルト 질풍전', 'ナルト 질풍'],
    ['borutoナルト', 'ナルト'],
  ])
    assert.equal(searchable(text, true, before), text, `${text} was held, as if still converting`)
})

test('an Enter that confirms an input method’s word is not taken for Enter', () => {
  assert.equal(confirmsWord({ isComposing: true, keyCode: 13 }), true, 'Chrome')
  assert.equal(confirmsWord({ isComposing: false, keyCode: 229 }), true, 'Safari')
  assert.equal(confirmsWord({ isComposing: false, keyCode: 13 }), false, 'an Enter')
})
