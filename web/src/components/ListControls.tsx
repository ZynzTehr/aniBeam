import { useId, useState } from 'react'
import { nextLine, said } from '../features/list/said.ts'
import {
  entryIn,
  getSnapshot,
  pressStatus,
  toggleFavorite,
  useEntry,
  type Entry,
  type Outcome,
  type Status,
} from '../features/list/store.ts'

// What the buttons show for a title's entry: its status, and its heart.
const shownFor = (entry: Entry | undefined) => `${entry?.status} ${Boolean(entry?.favorite)}`

/**
 * The title card's My List row (spec §3F, as the visitor chose in the mockup: the plan's D1 to D3):
 * a group of its own named "My List", above the card's actions, with Save and Want to try joined
 * as a pair, and Favorite. A title has one status: the other button moves it, and the pressed one
 * takes it off the list. The heart on a title not listed puts it on as Saved, with the heart (see
 * the store). Each button says whether it is pressed, aria-pressed written out either way, and
 * its label never changes; pressed, it fills in brand hot. Another tab's edit shows here as it
 * happens (see useEntry).
 *
 * Its own line, inside the dialog (the page behind is inert, so a line there would go unheard),
 * says what a screen reader can't tell from the button pressed: a move, a removal, the cap, or an
 * edit storage refused (see said). It is always there, so a change in it is heard, and visually
 * hidden, as the plan has it. The buttons show a move or a removal too, but not the cap or a
 * refused edit (nothing changes, or the press looks saved), so only a screen reader hears those
 * two. The line speaks of the buttons as this tab's last press left them: once another tab
 * changes what they show, it empties, saying nothing. The card's other line, for AniList's
 * hold-ups, stays its own.
 */
export function ListControls({ id }: { id: number }) {
  const name = useId()
  const entry = useEntry(id)
  const shown = shownFor(entry)
  // The line's words, with what the buttons showed when they were written. Once the buttons show
  // something else, another tab's edit, the line empties as this renders (React's way to follow a
  // change with state, with no effect and no second paint).
  const [line, setLine] = useState({ says: '', about: shown })
  if (line.says && line.about !== shown) setLine({ says: '', about: shown })
  const say = (outcome: Outcome, pressed: Status | null) => {
    const about = shownFor(entryIn(getSnapshot(), id))
    setLine((before) => ({ says: nextLine(before.says, said(outcome, pressed)), about }))
  }
  const statusButton = (status: Status, label: string) => {
    const pressed = entry?.status === status
    return (
      <button
        type="button"
        className={pressed ? 'ab-btn ab-btn-hot' : 'ab-btn'}
        aria-pressed={pressed}
        onClick={() => say(pressStatus(id, status), status)}
      >
        {label}
      </button>
    )
  }
  const favorite = Boolean(entry?.favorite)
  return (
    <>
      <div role="group" aria-labelledby={name} className="ab-mylist">
        <span id={name} className="ab-mylist-name">
          My List
        </span>
        <span className="ab-pair">
          {statusButton('SAVED', 'Save')}
          {statusButton('WANT', 'Want to try')}
        </span>
        {/* An inline heart: the site's fonts have none, and a system font might draw an emoji. */}
        <button
          type="button"
          className={favorite ? 'ab-btn ab-btn-hot ab-heart' : 'ab-btn ab-heart'}
          aria-pressed={favorite}
          onClick={() => say(toggleFavorite(id), null)}
        >
          <svg viewBox="0 0 24 22" aria-hidden="true">
            <path d="M12 20.5 3.1 11.8a5.3 5.3 0 0 1 0-7.5 5.3 5.3 0 0 1 7.5 0L12 5.7l1.4-1.4a5.3 5.3 0 0 1 7.5 7.5Z" />
          </svg>
          Favorite
        </button>
      </div>
      <p id="ab-list-status" role="status" className="sr-only">
        {line.says}
      </p>
    </>
  )
}
