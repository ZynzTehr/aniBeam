import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import type { Media } from '../../features/anime/queries.ts'
import { PullMachine } from '../../features/mood/PullMachine.tsx'
import { OpenCard } from './CardStage.tsx'
import { useHost } from './hosts.ts'
import { ListControls } from './ListControls.tsx'
import { POOL } from './pool.ts'
import { addAll, entryOf, useList } from './sandbox.ts'
import type { Options } from './switches.ts'

/** The hint D13's "now" would add, for a machine whose every title is on the list. */
const ALL_LISTED = 'Everything here is on your list. Try another decade.'

/**
 * Section 5: the site's own pull machine, drawing from the lab's titles, with a Save group beside
 * "Open title card" once the capsule opens (optional PR 4, or Phase 5), inert until then as the
 * result is. With D13's "now", the pull prefers titles not on the list and falls back to listed
 * ones, so the machine is never empty, and says so when everything in it is listed.
 */
export function PullStage({ options }: { options: Options }) {
  const list = useList()
  const unlisted = POOL.filter(({ id }) => !entryOf(list, id))
  const pool = options.d13 === 'now' && unlisted.length ? unlisted : POOL
  const allListed = unlisted.length === 0
  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })
  const [said, setSaid] = useState('')

  // Each pull draws a new result: the Save group goes into each one's actions.
  const [pulled, setPulled] = useState<number | null>(null)
  useEffect(() => {
    const reveal = document.querySelector('.ab-reveal')
    if (!reveal) return
    const watch = new MutationObserver(() => {
      const href = reveal.querySelector('.ab-result-panel')?.getAttribute('href')
      setPulled(href ? Number(href.split('/').pop()) : null)
    })
    watch.observe(reveal, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [])
  const group = useHost(
    () => {
      const actions = document.querySelector('.ab-result .ab-row-actions')
      return actions && { parent: actions }
    },
    pulled,
    'ab-lab-contents',
  )
  const hint = useHost(
    () => {
      const row = document.querySelector('.ab-pull-row')
      return row && { parent: row.parentElement!, before: row.nextSibling }
    },
    'hint',
    'ab-lab-under',
  )

  return (
    <>
      <main id="main">
        <div className="ab-lab-under">
          <h1 className="ab-lab-legend">The pull result</h1>
          <p className="ab-lab-why">
            Pull, and once the capsule opens its Save group sits beside “Open title card”. With D13
            on “now”, the machine skips titles on your list until every one is listed.
          </p>
          <button type="button" className="ab-btn" onClick={() => addAll(POOL.map(({ id }) => id))}>
            Put every title in the machine on the list
          </button>
        </div>
        <PullMachine pool={pool} onOpen={open} />
      </main>
      {pulled !== null &&
        createPortal(
          <ListControls id={pulled} options={options} placement="pull" onSaid={setSaid} />,
          group,
        )}
      {createPortal(
        <>
          {options.d13 === 'now' && allListed && <p className="ab-hint ab-lab-new">{ALL_LISTED}</p>}
          <p className="ab-lab-heard" aria-live="polite">
            <b>Heard:</b> {said || '(nothing yet: a plain press says nothing)'}
          </p>
        </>,
        hint,
      )}
      {card && (
        <OpenCard
          key={card.media.id}
          media={card.media}
          from={card.from}
          options={options}
          onClose={() => setCard(null)}
        />
      )}
    </>
  )
}
