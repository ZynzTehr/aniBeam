import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cssVars } from '../../components/cssVars.ts'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import { Strip } from '../../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../../components/TitleCard.tsx'
import type { Media } from '../../features/anime/queries.ts'
import {
  getSnapshot,
  listedIn,
  removeAll,
  setStatus,
  useListIds,
} from '../../features/list/store.ts'
import { PullMachine } from '../../features/mood/PullMachine.tsx'
import { accentVars } from '../../features/theming/deriveAccent.ts'
import { AfterHost } from './after.ts'
import { linkify, retext } from './doors.ts'
import { linksFor } from './links.ts'
import { SiteFrame } from './SiteFrame.tsx'
import type { Heard, Shown } from './Stage.tsx'
import { DISCOVER } from './titles.ts'
import { DOORS } from './wording.ts'

// The site's own lines that A2's link and the lab's list change (see PullMachine's HINTS).
const COMING_SOON = 'Coming soon: mood sliders for finer picks.'
const NOT_YET = 'The machine fills up with titles once AniList answers. It’s not something you did.'
const TERM = 'zzqqxx'

/**
 * Section 2: the doors into /mood. The site's header with A3's links; Discover's own pull machine
 * as A2 leaves it (the vibe chips with the "Fine-tune it" link, skipping the lab's list as PR 2
 * makes it; a teaser with one button; or unchanged); and the site's search results for a search
 * with none, with the spec's link to Mood (§3E).
 */
export function DoorsStage({ shown, heard }: { shown: Shown; heard: Heard }) {
  const { options } = shown
  const ids = useListIds()
  const listed = new Set(ids)
  const unlisted = DISCOVER.filter(({ id }) => !listed.has(id))
  const pool = options.a2 === 'link' ? unlisted : DISCOVER
  // The panel's list buttons, on Discover's machine. Each command acts once.
  const done = useRef(0)
  useEffect(() => {
    if (!heard || heard.n === done.current) return
    done.current = heard.n
    const ids = unlisted.map(({ id }) => id)
    if (heard.what === 'reset') removeAll(listedIn(getSnapshot()))
    if (heard.what === 'twenty') ids.slice(0, 20).forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'leave3') ids.slice(3).forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'drain') ids.forEach((id) => setStatus(id, 'SAVED'))
  }, [heard, unlisted])
  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })
  // The site's lines, changed in place where the lab has its words for them.
  useLayoutEffect(() => {
    linkify('.ab-lab-doors .ab-note', DOORS.searchLink, DOORS.searchLink, '/mood')
    if (options.a2 !== 'link') return
    linkify('.ab-pull .ab-hint:not(.ab-hint-room)', COMING_SOON, DOORS.hint, '/mood')
    if (!unlisted.length) retext('.ab-pull .ab-hint:not(.ab-hint-room)', NOT_YET, DOORS.allListed)
  })
  return (
    <SiteFrame links={linksFor(options.a3, 'discover')}>
      <main id="main" className="ab-lab-doors">
        {options.a2 === 'teaser' ? (
          <section className="ab-pull" aria-labelledby="pull">
            <SfxHeading id="pull" sfx="ガチャ!" small>
              Pull a title
            </SfxHeading>
            <div className="ab-lab-teaser">
              <div className="ab-dome" aria-hidden="true">
                {DISCOVER.slice(0, 9).map((media, i) => (
                  <span
                    key={media.id}
                    className="ab-capsule"
                    style={{ ...accentVars(media.coverImage.color), ...cssVars({ '--i': i }) }}
                  />
                ))}
              </div>
              <a className="ab-btn ab-btn-ink ab-lab-stamp" href="/mood">
                {DOORS.teaser}
              </a>
            </div>
          </section>
        ) : (
          <PullMachine key={`${options.a2}-${unlisted.length === 0}`} pool={pool} onOpen={open} />
        )}
        <Strip
          id="ab-lab-search"
          heading={`Results for “${TERM}”`}
          sfx="サーチ!"
          titles={[]}
          note={DOORS.search(TERM)}
          grid
        />
      </main>
      <DoorNotes shown={shown} />
      {card && (
        <TitleCard
          key={card.media.id}
          media={card.media}
          from={card.from}
          onClose={() => setCard(null)}
        />
      )}
    </SiteFrame>
  )
}

/** The lab's notes on this section, after the footer. */
function DoorNotes({ shown }: { shown: Shown }) {
  const host = useContext(AfterHost)
  const { a2, a3 } = shown.options
  if (!host) return null
  return createPortal(
    <section className="ab-lab-box" aria-label="Lab: the doors">
      <h2 className="ab-lab-legend">
        <span className="ab-lab-tag">Lab</span> The doors
      </h2>
      <p className="ab-lab-why">
        A2 {a2 === 'link' ? '(a)' : a2 === 'teaser' ? '(b)' : '(c)'}: Discover’s machine{' '}
        {a2 === 'link'
          ? 'skips the lab’s list (PR 2), and its hint links to /mood. Press “Empty the pool” to list every title in it and see its line for that.'
          : a2 === 'teaser'
            ? 'is a teaser with one button; there is no pulling on Discover.'
            : 'stays as it is today, with no link.'}{' '}
        A3 {a3 === 'door' ? '(a)' : a3 === 'header' ? '(b)' : '(c)'}:{' '}
        {a3 === 'door'
          ? 'no header change.'
          : 'the header’s links change; try 768 (the phone menu, with ムード) and 1440. The intro’s dock and its flight are not run in the lab: the header shows as it would once docked.'}{' '}
        The search’s empty state links to Mood in every option, as the spec asks (§3E).
      </p>
    </section>,
    host,
  )
}
