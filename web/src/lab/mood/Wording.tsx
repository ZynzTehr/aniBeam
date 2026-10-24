import type { Lab, Options } from './switches.ts'

/** Goes to a section of the lab, with any state and choices, loaded again. */
export type GoTo = (patch: Partial<Lab>, picks?: Partial<Options>) => void

/** Section 3: every string of the Mood page and its doors, for one-pass approval. */
export function Wording({ goTo }: { goTo: GoTo }) {
  void goTo
  return (
    <div className="ab-lab-text">
      <p className="ab-lab-why">The wording: built in a later commit.</p>
    </div>
  )
}
