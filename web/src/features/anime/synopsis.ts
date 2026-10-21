// A title's synopsis as the card draws it. AniList's description, even with asHtml: false, holds
// <br>, <i> and <b> (and on a few titles a link) with some HTML entities. It becomes runs of plain
// text, which React escapes: no HTML string reaches the page, so a hostile description (a script
// tag, an attribute, a javascript: link, an entity that decodes to markup) can only show as text.

/** A stretch of text, emphasized (in italics), strong (in bold), both or neither. */
export type Run = { text: string; em: boolean; strong: boolean }
/**
 * Paragraphs of lines of runs, and the source its "(Source: …)" or "[Written by …]" paragraph
 * names, if any.
 */
export type Synopsis = { paragraphs: Run[][][]; source: string | null }

// A tag starts with a letter, so "a < b" stays text. Only its name counts: attributes drop.
const TAG = /(<\/?[a-z][^<>]*>)/i
// A paragraph that is a source line, whole: "(Source: Crunchyroll)", "[Written by MAL Rewrite]".
const SOURCE = /^(?:\(Source:(.+)\)|\[Written by (.+)\])$/i
// HTML's five for markup, its Latin-1 set in order from nbsp (U+00A0) to yuml (U+00FF), as in
// Nausicaä's and Heidi's (Öhi) descriptions, and its typographic marks, as in Wolf Children's.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
const MARKS =
  'OElig oelig Scaron scaron Yuml fnof circ tilde ensp emsp thinsp ndash mdash lsquo rsquo sbquo ldquo rdquo bdquo dagger Dagger bull hellip permil prime Prime lsaquo rsaquo euro trade'
const MARKED = 'ŒœŠšŸƒˆ˜\u2002\u2003\u2009–—‘’‚“”„†‡•…‰′″‹›€™'
const NAMED = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ...LATIN1.split(' ').map((name, i): [string, string] => [name, String.fromCharCode(0xa0 + i)]),
  ...MARKS.split(' ').map((name, i): [string, string] => [name, MARKED[i]]),
])

/** Decodes those named entities and any numeric one; others stay as written. */
export const decodeEntities = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (whole, name: string) => {
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
 * <b>/<strong> open and close their style, one inside its like closing only itself, as in HTML,
 * and a paragraph's end closes both, so a tag left open can't run on. Every other tag drops and
 * keeps its text. The source is the first source line's: AniList puts a synopsis's own source
 * right after it, before any note, and a note can name a source of its own.
 */
export function parseSynopsis(description: string | null | undefined): Synopsis {
  const paragraphs: Run[][][] = []
  let paragraph: Run[][] = []
  let line: Run[] = []
  let [breaks, em, strong] = [0, 0, 0]
  // The <br>s seen since the last text take effect once more text or a style comes.
  const flush = () => {
    if (breaks > 0) {
      line = tidy(line)
      if (line.length) paragraph.push(line)
      line = []
    }
    if (breaks > 1) {
      if (paragraph.length) paragraphs.push(paragraph)
      ;[paragraph, em, strong] = [[], 0, 0]
    }
    breaks = 0
  }
  for (const [i, piece] of (description ?? '').split(TAG).entries()) {
    const [, end, name = ''] = (i % 2 && /^<(\/?)([a-z]+)/i.exec(piece)) || []
    const tag = name.toLowerCase()
    if (tag === 'br') breaks++
    else if (tag === 'i' || tag === 'em' || tag === 'b' || tag === 'strong') {
      flush()
      // A close with none open (a stray) closes nothing.
      if (tag === 'i' || tag === 'em') em = Math.max(0, em + (end ? -1 : 1))
      else strong = Math.max(0, strong + (end ? -1 : 1))
    } else if (i % 2 === 0 && piece) {
      if (piece.trim()) flush()
      line.push({ text: decodeEntities(piece), em: em > 0, strong: strong > 0 })
    }
  }
  breaks = 2
  flush()
  const text = (lines: Run[][]) => lines.map((runs) => runs.map((r) => r.text).join('')).join(' ')
  const at = paragraphs.findIndex((lines) => SOURCE.test(text(lines)))
  if (at < 0) return { paragraphs, source: null }
  const [, source, writer] = SOURCE.exec(text(paragraphs.splice(at, 1)[0]))!
  return { paragraphs, source: (source ?? writer).trim() }
}
