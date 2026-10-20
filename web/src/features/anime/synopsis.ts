// A title's synopsis as the card draws it. AniList's description, even with asHtml: false, holds
// <br>, <i> and <b> (and on a few titles a link) with some HTML entities. It becomes runs of plain
// text, which React escapes: no HTML string reaches the page, so a hostile description (a script
// tag, an attribute, a javascript: link, an entity that decodes to markup) can only show as text.

/** A stretch of text, emphasized (in italics), strong (in bold), both or neither. */
export type Run = { text: string; em: boolean; strong: boolean }
/** Paragraphs of lines of runs, and the source its "(Source: …)" paragraph names, if any. */
export type Synopsis = { paragraphs: Run[][][]; source: string | null }

// A tag starts with a letter, so "a < b" stays text. Only its name counts: attributes drop.
const TAG = /(<\/?[a-z][^<>]*>)/i
const NAMED = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['mdash', '—'],
  ['ndash', '–'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['hellip', '…'],
])

/** Decodes the named entities AniList uses and any numeric one; others stay as written. */
export const decodeEntities = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return NAMED.get(name) ?? whole
    const code = /x/i.test(name[1]) ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })

/** A line's runs with HTML's whitespace collapsed, neighbors in one style joined, ends trimmed. */
function tidy(runs: Run[]) {
  const line: Run[] = []
  for (const run of runs) {
    const last = line.at(-1)
    let text = run.text.replace(/[ \t\n\r\f]+/g, ' ')
    if (!last || last.text.endsWith(' ')) text = text.replace(/^ /, '')
    if (last && last.em === run.em && last.strong === run.strong) last.text += text
    else if (text) line.push({ ...run, text })
  }
  const last = line.at(-1)
  if (last?.text.endsWith(' ')) last.text = last.text.slice(0, -1)
  if (last && !last.text) line.pop()
  return line
}

/**
 * Two or more <br> in a row (</br> counts as one) end a paragraph, one ends a line. <i>/<em> and
 * <b>/<strong> turn their style on and off, and a paragraph's end turns both off, so a tag left
 * open can't run on. Every other tag drops and keeps its text.
 */
export function parseSynopsis(description: string | null | undefined): Synopsis {
  const paragraphs: Run[][][] = []
  let paragraph: Run[][] = []
  let line: Run[] = []
  let [breaks, em, strong] = [0, false, false]
  // The <br>s seen since the last text take effect once more text or a style comes.
  const flush = () => {
    if (breaks > 0) {
      line = tidy(line)
      if (line.length) paragraph.push(line)
      line = []
    }
    if (breaks > 1) {
      if (paragraph.length) paragraphs.push(paragraph)
      ;[paragraph, em, strong] = [[], false, false]
    }
    breaks = 0
  }
  for (const [i, piece] of (description ?? '').split(TAG).entries()) {
    const [, end, name = ''] = (i % 2 && /^<(\/?)([a-z]+)/i.exec(piece)) || []
    const tag = name.toLowerCase()
    if (tag === 'br') breaks++
    else if (tag === 'i' || tag === 'em' || tag === 'b' || tag === 'strong') {
      flush()
      if (tag === 'i' || tag === 'em') em = !end
      else strong = !end
    } else if (i % 2 === 0 && piece) {
      if (piece.trim()) flush()
      line.push({ text: decodeEntities(piece), em, strong })
    }
  }
  breaks = 2
  flush()
  const text = (lines: Run[][]) => lines.map((runs) => runs.map((r) => r.text).join('')).join(' ')
  const at = paragraphs.findLastIndex((lines) => /^\(Source:.+\)$/i.test(text(lines)))
  const source = at < 0 ? null : text(paragraphs.splice(at, 1)[0]).slice(8, -1).trim()
  return { paragraphs, source }
}
