// What Japanese and Chinese input methods show while they are still converting: CJK symbols,
// kana and zhuyin (U+3000-312F), CJK ideographs (U+3400-9FFF, and the compatibility ones at
// U+F900-FAFF) and full-width letters (U+FF00-FFEF). Hangul is left out: Korean shows final
// letters as you type. The ranges are escapes because a pasted U+F900 can be normalized to
// U+8C48, which would take in Hangul.
const CONVERTING = /[\u3000-\u312f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/

/**
 * What to search while the box shows `text`. While an input method is still converting
 * Japanese or Chinese (`composing`), the box shows kana and candidates that aren't the word
 * yet, so the search stays with what the box held before the conversion began (`before`).
 * Latin text still composing is searched as typed: Android keyboards compose every word.
 */
export const searchable = (text: string, composing: boolean, before: string) =>
  composing && CONVERTING.test(text) ? before : text
