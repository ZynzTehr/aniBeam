import { useId } from 'react'
import { titleOf } from '../../features/anime/format.ts'
import { titleFor } from './pool.ts'
import { entryOf, press, setStatus, toggleFavorite, useList, type Status } from './sandbox.ts'
import type { Options } from './switches.ts'
import { WORDS } from './wording.ts'

/**
 * Where the controls sit: the title card's T1 (in its action row) or T2 (a row of their own), a
 * slim row under a My List cover (L1), or the pull result's Save group.
 */
export type Placement = 't1' | 't2' | 'slim' | 'pull'

/**
 * Save, Want to try and Favorite for one title, as the switches set them: a group named "My
 * List", each button with an explicit aria-pressed and a label that never changes (D3), the two
 * statuses as a pair or one three-way control (D1), and the heart's rule for a title not on the
 * list (D2). `onSaid` gets what the status line says after a press: only a move, a removal, a
 * failed save or the cap, never a plain press.
 */
export function ListControls({
  id,
  options,
  placement,
  onSaid,
}: {
  id: number
  options: Options
  placement: Placement
  onSaid: (said: string) => void
}) {
  const nameId = useId()
  const entry = entryOf(useList(), id)
  const pressedLook = options.d3look === 'hot' ? 'ab-btn ab-btn-hot' : 'ab-btn ab-lab-stamped'
  const look = (pressed: boolean) => (pressed ? pressedLook : 'ab-btn')
  const say = (said: string) => onSaid(said)
  const statusButton = (status: Status, label: string) => (
    <button
      type="button"
      className={look(entry?.status === status)}
      aria-pressed={entry?.status === status}
      onClick={() => say(press(id, status))}
    >
      {label}
    </button>
  )
  const waits = options.d2 === 'waits' && !entry
  // Shown only on T2, its own row: elsewhere the name is for screen readers. Under a cover (L1)
  // it names the title too, so a grid of groups isn't twelve alike.
  const nameClass = placement === 't2' ? 'ab-lab-mylist-name' : 'sr-only'
  const media = placement === 'slim' ? titleFor(id) : null
  const name = media ? `${WORDS.group}: ${titleOf(media)}` : WORDS.group
  const heart = (
    <button
      type="button"
      className={`${look(Boolean(entry?.favorite))} ab-lab-heart${waits ? ' ab-lab-off' : ''}`}
      aria-pressed={Boolean(entry?.favorite)}
      aria-disabled={waits || undefined}
      aria-describedby={waits ? `${nameId}-why` : undefined}
      onClick={() => say(toggleFavorite(id, options.d2))}
    >
      <svg viewBox="0 0 24 22" aria-hidden="true">
        <path d="M12 20.5 3.1 11.8a5.3 5.3 0 0 1 0-7.5 5.3 5.3 0 0 1 7.5 0L12 5.7l1.4-1.4a5.3 5.3 0 0 1 7.5 7.5Z" />
      </svg>
      {placement === 'slim' ? <span className="sr-only">{WORDS.favorite}</span> : WORDS.favorite}
    </button>
  )
  const statuses =
    options.d1 === 'three' ? (
      <fieldset className="ab-lab-three">
        <legend className="sr-only">Status</legend>
        {(
          [
            ['SAVED', WORDS.saved],
            ['WANT', WORDS.want],
            [null, 'Not listed'],
          ] as const
        ).map(([status, label]) => (
          <label key={label} className="ab-chip">
            <input
              type="radio"
              name={`${nameId}-status`}
              checked={(entry?.status ?? null) === status}
              onChange={() => say(setStatus(id, status))}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    ) : (
      <span className="ab-lab-pair">
        {statusButton('SAVED', options.d3label === 'save' ? WORDS.save : WORDS.saved)}
        {statusButton('WANT', WORDS.want)}
      </span>
    )
  return (
    <div
      role="group"
      aria-labelledby={nameId}
      className={`ab-lab-mylist ab-lab-at-${placement}`}
      data-id={id}
    >
      <span id={nameId} className={nameClass}>
        {name}
      </span>
      {statuses}
      {heart}
      {waits && (
        <span id={`${nameId}-why`} className="sr-only">
          Save the title first.
        </span>
      )}
    </div>
  )
}
