// What Japanese and Chinese input methods show while they are still converting: CJK symbols,
// kana and zhuyin (U+3000-312F), CJK ideographs (U+3400-9FFF, and the compatibility ones at
// U+F900-FAFF) and full-width letters (U+FF00-FFEF). Hangul is left out: Korean shows final
// letters as you type. The ranges are escapes because a pasted U+F900 can be normalized to
// U+8C48, which would take in Hangul.
const CONVERTING = /[\u3000-\u312f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/

/**
 * The word being composed: the part of `text` that differs from `before`, what the box held
 * when the input method began. What the two share at the start and at the end is left out, so
 * the word counts wherever it was typed: after the other words, in front of them, or over
 * selected text.
 */
function composed(text: string, before: string) {
  let start = 0
  while (start < text.length && text[start] === before[start]) start++
  let end = text.length
  let old = before.length
  // The shared end stops where the shared start ends: otherwise a word that repeats the letters
  // before it (のん after のん) would vanish into them.
  while (old > start && text[end - 1] === before[old - 1]) {
    end--
    old--
  }
  return text.slice(start, end)
}

/**
 * What to search while the box shows `text`. While an input method is still converting
 * Japanese or Chinese (`composing`), the box shows kana and candidates that aren't the word
 * yet, so the search stays with what the box held before the conversion began (`before`).
 * Only the word being composed is judged, not the rest of the box, so Latin text still
 * composing is searched as typed, even after a Japanese word: Android keyboards compose every
 * word.
 */
export const searchable = (text: string, composing: boolean, before: string) =>
  composing && CONVERTING.test(composed(text, before)) ? before : text

/**
 * Whether a key press is an input method's rather than its own, such as an Enter that confirms
 * a word or an Esc that undoes a conversion: Chrome marks it composing; Safari ends the
 * composition first, then sends the key as keyCode 229.
 */
export const confirmsWord = (event: { isComposing: boolean; keyCode: number }) =>
  event.isComposing || event.keyCode === 229
