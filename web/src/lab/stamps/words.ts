import type { Surface, StampPage } from '../../components/stampDraw.ts'
import type { Entry } from '../../features/list/store.ts'
import type { Options } from './switches.ts'

/** What a listed cover's stamp shows and speaks. */
export type Shown = {
  /** Its visible word, or null for a heart alone. */
  word: 'SAVED' | 'WANT' | null
  heart: boolean
  /** What a screen reader hears at the end of the cover's name: ", saved, favorite". */
  spoken: string
  /** Changes with what it shows, so a change draws a new stamp: nothing grows in place. */
  key: string
}

/** S6's letter for each surface; My List follows S8 instead. */
const LETTER: Record<Surface, string> = {
  trending: 't',
  strip: 'd',
  search: 's',
  match: 'm',
  roll: 'r',
  list: '',
}

/**
 * The stamp a listed title's cover shows on `surface`, as the switches say, or null for none: S6
 * (the surface off), S3 (the heart alone), and on My List S8 (with `page`, what the page already
 * says).
 */
export function stampOf(
  entry: Entry,
  options: Options,
  surface: Surface,
  page?: StampPage,
): Shown | null {
  if (surface !== 'list' && !options.s6.includes(LETTER[surface])) return null
  const word: Shown['word'] = options.s3 === 'a' ? entry.status : null
  const heart = entry.favorite
  void page
  if (!word && !heart) return null
  const spoken = [word && (word === 'SAVED' ? 'saved' : 'want to try'), heart && 'favorite']
    .filter(Boolean)
    .map((part) => `, ${part}`)
    .join('')
  return { word, heart, spoken, key: `${word ?? 'none'}-${heart ? 'heart' : 'plain'}` }
}
