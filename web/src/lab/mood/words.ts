// The lab's words for what the Mood page shows: rarity, the Why line, the sliders' set words. The
// strings to approve (A14) are in wording.ts.
import { AXES, wordOf, type Axis } from '../../features/mood/moods.ts'
import { AXIS_KEYS, type Sliders } from './score.ts'
import type { Options } from './switches.ts'

/** A title's rarity: the same rule as Discover's pull (PullMachine's rarityOf, not exported). */
export function rarityOf(score: number | null) {
  if (score === null) return { key: 'mystery', label: 'Mystery', stars: '?', sfx: '!?' }
  if (score >= 85) return { key: 'ssr', label: 'SSR', stars: '★★★', sfx: 'SSR!!' }
  if (score >= 75) return { key: 'sr', label: 'SR', stars: '★★', sfx: 'SR!' }
  return { key: 'r', label: 'R', stars: '★', sfx: 'R' }
}

/** The set sliders' words, such as "Very cozy · Dark"; empty when none is set. */
export const setWords = (sliders: Sliders) =>
  AXIS_KEYS.filter((axis) => sliders[axis] !== 0)
    .map((axis) => wordOf(axis, sliders[axis]))
    .join(' · ')

/** The Why line as A8's (a) and (b) word it; (c) draws stickers instead (see Matches). */
export function whyText(names: string[], style: Options['a8']) {
  if (!names.length) return ''
  if (style === 'matched') return `Matched on ${names.join(' and ')}.`
  return `Why: ${names.join(' · ')}`
}

/** The axes' labels, for the lab's debug view. */
export const AXIS_LABELS = AXIS_KEYS.map((axis) => AXES[axis].label)

/** The sliders the lab shows: three, or two without Complexity (A4 b). */
export const axesFor = (options: Options): Axis[] =>
  options.a4 === 'two' ? ['energy', 'tone'] : ['energy', 'tone', 'complexity']
