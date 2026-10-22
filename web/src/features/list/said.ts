import { CAP, type Outcome, type Status } from './store.ts'

// What the title card's My List line says after a press (see ListControls), in the words the
// visitor approved in the mockup (the plan's D14). A screen reader hears it; the buttons' own
// state, pressed or not, says the rest.
export const SAID = {
  movedWant: 'Moved to Want to try',
  movedSaved: 'Moved to Saved',
  removed: 'Removed from My List',
  kept: 'Couldn’t save on this device. Kept for this visit.',
  full: `My List is full (${CAP.toLocaleString('en-US')})`,
}

/**
 * What the line says after a press on Save or Want to try (`pressed`), or on the heart (null), that
 * had `outcome`: a move, saying where to, as the other button letting go would go unheard; a
 * removal; the cap; and, after any of these or a plain press, an edit storage refused, kept for
 * the visit. A plain press says nothing (''), as the button's own state says it.
 */
export function said({ change, saved }: Outcome, pressed: Status | null) {
  if (change === 'full') return SAID.full
  const lines = []
  if (change === 'moved') lines.push(pressed === 'WANT' ? SAID.movedWant : SAID.movedSaved)
  if (change === 'removed') lines.push(SAID.removed)
  if (!saved) lines.push(SAID.kept)
  return lines.join('. ')
}
