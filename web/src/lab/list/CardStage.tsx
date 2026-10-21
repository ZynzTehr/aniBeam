import { useState } from 'react'
import { createPortal } from 'react-dom'
import { TitleCard } from '../../components/TitleCard.tsx'
import { titleOf } from '../../features/anime/format.ts'
import type { Media } from '../../features/anime/queries.ts'
import { useHost } from './hosts.ts'
import { ListControls } from './ListControls.tsx'
import { titleFor } from './pool.ts'
import type { Options } from './switches.ts'

/** The middle of the screen: where a card opened at its address grows from, as on the site. */
const middle = () => new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0)

/**
 * Section 1: the site's own title card, opened as the real modal card, with the list controls
 * placed in it as the switches set them (see CardControls). Closed, the page under it offers to
 * open it again.
 */
export function CardStage({ options, title }: { options: Options; title: number }) {
  const media = titleFor(title)
  const [open, setOpen] = useState(true)
  const [opens, setOpens] = useState(0)
  if (!media) return null
  return (
    <>
      <main id="main" className="ab-lab-under">
        <h1 className="ab-lab-legend">The title card</h1>
        <p className="ab-lab-why">
          {titleOf(media)}: {media.bannerImage ? 'with a banner.' : 'no banner.'} Press the buttons,
          then reload: the lab’s list keeps them. The line at the card’s foot shows what a screen
          reader hears.
        </p>
        <button
          type="button"
          className="ab-btn ab-btn-ink"
          onClick={(event) => {
            event.currentTarget.blur()
            setOpens(opens + 1)
            setOpen(true)
          }}
        >
          Open the card
        </button>
      </main>
      {open && (
        <OpenCard
          key={`${media.id}-${opens}`}
          media={media}
          options={options}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The card, and the lab's controls in it. */
export function OpenCard({
  media,
  options,
  onClose,
  from = middle(),
}: {
  media: Media
  options: Options
  onClose: () => void
  from?: DOMRect
}) {
  const [card] = useState(from)
  return (
    <>
      <TitleCard media={media} from={card} onClose={onClose} />
      <CardControls id={media.id} options={options} />
    </>
  )
}

/**
 * The controls in the open card, where the D3 layout puts them: T2, a row of their own above the
 * action row; T1, in the action row, where "Save to My List Soon" stood. That button is hidden
 * either way ("Chat about it Soon" stays). The card also gets a second status line, inside the
 * dialog, as the page behind is inert and a line there would never be read: visually hidden, as
 * planned, and always on the page; the lab shows what it says at the card's foot.
 */
function CardControls({ id, options }: { id: number; options: Options }) {
  const [said, setSaid] = useState('')
  const t1 = options.d3layout === 't1'
  const row = () => document.querySelector('dialog.ab-card .ab-row-actions')
  const soon = () =>
    [...(row()?.querySelectorAll('button.ab-soon') ?? [])].find((button) =>
      button.textContent?.startsWith('Save to My List'),
    )
  const controls = useHost(
    () => {
      const actions = row()
      const old = soon()
      if (!actions || !old) return null
      old.setAttribute('hidden', '')
      return t1
        ? { parent: actions, before: old }
        : { parent: actions.parentElement!, before: actions }
    },
    t1,
    t1 ? 'ab-lab-host-t1' : 'ab-lab-host-t2',
  )
  const status = useHost(
    () => {
      const dialog = document.querySelector('dialog.ab-card')
      return dialog && { parent: dialog }
    },
    'status',
    'ab-lab-heard-host',
  )
  return (
    <>
      {createPortal(
        <ListControls id={id} options={options} placement={t1 ? 't1' : 't2'} onSaid={setSaid} />,
        controls,
      )}
      {createPortal(
        <>
          <p role="status" className="sr-only">
            {said}
          </p>
          <p className="ab-lab-heard" aria-hidden="true">
            <b>Heard:</b> {said || '(nothing yet: a plain press says nothing)'}
          </p>
        </>,
        status,
      )}
    </>
  )
}
