// The lab's stand-ins for PR 13's synopsis parser and tag filter, just enough to draw the saved
// titles: the real ones come with their tests in PR 13. No HTML string reaches the page: the
// synopsis becomes runs of text, which React escapes.
import type { LabTag, LabTitle } from './types.ts'

/** A stretch of text, in italics or bold or neither. */
export type Run = { text: string; em: boolean; strong: boolean }
/** Paragraphs of lines of runs, and the "(Source: …)" line's source, if it ends with one. */
export type Synopsis = { paragraphs: Run[][][]; source: string | null }

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}
const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name: string) =>
    name[0] === '#'
      ? String.fromCodePoint(Number(name[1] === 'x' ? `0${name.slice(1)}` : name.slice(1)))
      : (ENTITIES[name.toLowerCase()] ?? whole),
  )

/** One line's runs: <i>/<em> and <b>/<strong> turn their style on and off; other tags drop. */
function runsOf(line: string): Run[] {
  const runs: Run[] = []
  let em = false
  let strong = false
  for (const part of line.split(/(<\/?[a-z]+[^>]*>)/i)) {
    const tag = /^<(\/?)([a-z]+)/i.exec(part)
    if (tag) {
      const on = tag[1] === ''
      if (/^(i|em)$/i.test(tag[2])) em = on
      if (/^(b|strong)$/i.test(tag[2])) strong = on
    } else if (part) runs.push({ text: decode(part), em, strong })
  }
  return runs
}

/** A description as AniList gives it with asHtml: false, which still holds <br>, <i> and <b>. */
export function synopsisOf(description: string): Synopsis {
  const text = description
    .replace(/\r\n?/g, '\n')
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .trim()
  const blocks = text.split(/\n{2,}/)
  const last = /^\(Source:\s*(.+)\)$/i.exec(blocks.at(-1) ?? '')
  if (last) blocks.pop()
  return {
    paragraphs: blocks.map((block) => block.split('\n').map(runsOf)),
    source: last ? decode(last[1]) : null,
  }
}

/** A title's tags as the card shows them: no adult tags, by rank, spoilers apart, capped. */
export function tagsOf(title: LabTitle, cap: number) {
  const safe = title.tags.filter((tag) => !tag.adult).sort((a, b) => b.rank - a.rank)
  const plain = safe.filter((tag) => !tag.spoiler)
  const spoilers = safe.filter((tag) => tag.spoiler)
  return {
    shown: plain.slice(0, cap),
    spoilers: spoilers.slice(0, cap),
    /** How many of each the cap leaves out. */
    left: plain.length - Math.min(cap, plain.length),
    spoilersLeft: spoilers.length - Math.min(cap, spoilers.length),
  } satisfies Record<string, LabTag[] | number>
}

/** The Director and Music credits among the saved ones, or why there are none. */
export function creditsOf(title: LabTitle) {
  if (!title.staff) return null
  const find = (role: RegExp) =>
    title.staff
      ?.filter((credit) => role.test(credit.role))
      .map(({ name }) => name)
      .join(', ') || null
  return { director: find(/^Director$/), music: find(/^Music\b/) }
}
