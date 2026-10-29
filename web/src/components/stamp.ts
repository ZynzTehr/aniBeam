import { createContext } from 'react'
import type { Entry, Status } from '../features/list/store.ts'

// The stamp on a listed title's cover (the plan's D4, option A; Phase 4's PR 4, item 1): SAVED or
// WANT, with a heart for a favorite, drawn by Stamp.tsx and heard at the end of the cover's name.

/**
 * True below it, no stamps: main.tsx's development-only pages, the gallery and the prototypes,
 * whose sample titles have real AniList ids, so a stamp there would show whatever this browser's
 * list held, not the design (the stamps' plan, S6). A production build leaves it out.
 */
export const Unstamped = /* @__PURE__ */ createContext(false)

/** What My List's page already says of the covers it shows: the tab, and Favorites only. */
export type StampPage = { tab?: Status; favoritesOnly?: boolean }

/** What a listed title's cover shows and says (see stampOf). */
export type Shown = {
  /** Changes with what it shows, so a change draws a new stamp: nothing grows in place. */
  key: string
  /** Its word, or null for the heart alone. */
  word: Status | null
  heart: boolean
  /** What a screen reader hears at the end of the cover's name, as ", saved, favorite". */
  spoken: string
}

/**
 * The stamp for a title's entry (see useEntry), or null for none, as for a title not on the list.
 * On My List (`page`), only what the page doesn't already say: the word when it isn't the tab's,
 * as for a title moved in its card, which stays in the view it opened with; the heart unless
 * Favorites only is on.
 */
export function stampOf(entry: Entry | undefined, page?: StampPage): Shown | null {
  if (!entry) return null
  const word = entry.status === page?.tab ? null : entry.status
  const heart = entry.favorite && !page?.favoritesOnly
  if (!word && !heart) return null
  const spoken =
    (word ? (word === 'SAVED' ? ', saved' : ', want to try') : '') + (heart ? ', favorite' : '')
  return { key: `${word} ${heart}`, word, heart, spoken }
}
