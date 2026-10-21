import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MangaPage } from '../../components/MangaPage.tsx'
import { Strip } from '../../components/Strip.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { titleOf } from '../../features/anime/format.ts'
import { LANDING_PARTS, startLanding } from '../../lib/landing.ts'
import type { Media } from '../../features/anime/queries.ts'
import { OpenCard } from './CardStage.tsx'
import { useMeasured, useSlots } from './hosts.ts'
import { spokenName, tabStops } from './page.ts'
import { LAB_TITLES, POOL, titleFor } from './pool.ts'
import { entryOf, press, twelve, useList, type Entry } from './sandbox.ts'
import type { Options } from './switches.ts'

const lab = LAB_TITLES.map(titleFor).filter((media): media is Media => media !== null)
const others = POOL.filter(({ id }) => !LAB_TITLES.includes(id))
// Trending: the six lab titles, which "Twelve titles" saves (panels 4 and 5, at the diagonal cut,
// among them), and three it leaves off. The decade strip and a search show others too.
const TRENDING = [...lab, ...others.slice(9, 12)]
const DECADE = [...others.slice(0, 9), ...others.slice(12, 19)]
const SEARCH = [lab[0], lab[4], lab[5]]

/** ", saved, favorite": what option A adds to a listed cover's name. */
const spokenEntry = (entry: Entry) =>
  `, ${entry.status === 'SAVED' ? 'saved' : 'want to try'}${entry.favorite ? ', favorite' : ''}`

/**
 * Section 2: covers as the site draws them, a trending page, the decade strip and a search
 * result, with D4's options placed in them: N leaves them as they are; A stamps a listed cover
 * above its caption (bottom left on a trending panel, where the score bubble holds the top right)
 * and adds its state to the link's name; B puts a 44x44 button beside each cover. A line at the
 * top counts the Tab stops, live.
 */
export function CoversStage({ options }: { options: Options }) {
  const list = useList()
  const [main, setMain] = useState<HTMLElement | null>(null)
  // Parts slam in once as they scroll into view, as on the site.
  useLayoutEffect(() => startLanding(LANDING_PARTS), [])
  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })

  const option = options.d4
  // A: a stamp in each cover's caption (or strip title), shown when the title is listed.
  const captions = useSlots(
    option === 'a' ? main : null,
    '.ab-caption, .ab-strip-title',
    option,
    'ab-lab-stamp-host',
  )
  // B: a button in each cover's list item, beside its link.
  const items = useSlots(
    option === 'b' ? main : null,
    '.ab-grid > .ab-panel, .ab-strip-row > .ab-strip-item',
    option,
    'ab-lab-mark-host',
  )

  // The live counts: Tab stops now, and what each option adds.
  const { stops, heard } = useMeasured(
    () => {
      if (!main) return { stops: { now: 0, covers: 0 }, heard: '' }
      const first = [...main.querySelectorAll('.ab-link')].find((link) =>
        entryOf(list, Number(link.getAttribute('href')?.split('/').pop())),
      )
      return {
        stops: {
          now: tabStops(main).length,
          covers: main.querySelectorAll('.ab-link, .ab-strip-panel[href]').length,
        },
        heard: first ? spokenName(first) : '',
      }
    },
    [main, option, list, captions, items],
    { stops: { now: 0, covers: 0 }, heard: '' },
  )
  const listed = TRENDING.concat(DECADE).filter(({ id }) => entryOf(list, id)).length

  return (
    <>
      <main id="main" ref={setMain}>
        <div className="ab-lab-under">
          <h1 className="ab-lab-legend">Covers</h1>
          <p className="ab-lab-why" aria-live="polite">
            <b>D4 {option.toUpperCase()}.</b> Tab stops on this page: <b>{stops.now}</b>
            {option === 'b'
              ? ` (option B adds ${stops.covers}, one per cover; N and A add 0).`
              : ` (N and A add 0; B would add ${stops.covers}, one per cover).`}{' '}
            {listed === 0 && 'Nothing here is on the lab’s list yet. '}
            {option === 'a' &&
              heard &&
              `A screen reader hears the first listed panel as “${heard}”.`}
          </p>
          {listed === 0 && (
            <button type="button" className="ab-btn" onClick={twelve}>
              Put twelve titles on the list
            </button>
          )}
        </div>
        <MangaPage
          id="ab-trending"
          heading="Trending now"
          sfx="ドン!"
          titles={TRENDING}
          onOpen={open}
        />
        <Strip id="decades" heading="Browse by decade" sfx="バーン" titles={DECADE} onOpen={open} />
        <Strip
          id="results"
          heading="Results for “frieren”"
          sfx="サーチ!"
          titles={SEARCH}
          onOpen={open}
          live={false}
          grid
        />
      </main>
      {captions.map(({ id, host }) => {
        const entry = entryOf(list, id)
        return entry && createPortal(<Stamp entry={entry} />, host, id)
      })}
      {items.map(({ id, host }) => createPortal(<Mark id={id} />, host, id))}
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

/** Option A: an inked stamp, "SAVED" or "WANT", with a heart for a favorite. */
function Stamp({ entry }: { entry: Entry }) {
  return (
    <>
      <span className="ab-lab-stamp" aria-hidden="true">
        {entry.status === 'SAVED' ? 'Saved' : 'Want'}
        {entry.favorite && (
          <svg viewBox="0 0 24 22">
            <path d="M12 20.5 3.1 11.8a5.3 5.3 0 0 1 0-7.5 5.3 5.3 0 0 1 7.5 0L12 5.7l1.4-1.4a5.3 5.3 0 0 1 7.5 7.5Z" />
          </svg>
        )}
      </span>
      <span className="sr-only">{spokenEntry(entry)}</span>
    </>
  )
}

/** Option B: a bookmark button beside the cover, outside its link. */
function Mark({ id }: { id: number }) {
  const entry = entryOf(useList(), id)
  const media = titleFor(id)
  const saved = entry?.status === 'SAVED'
  return (
    <button
      type="button"
      className="ab-lab-mark"
      aria-pressed={saved}
      aria-label={`Save ${media ? titleOf(media) : id}`}
      onClick={() => press(id, 'SAVED')}
    >
      <svg viewBox="0 0 16 20" aria-hidden="true">
        <path d="M2 1h12v18l-6-5-6 5Z" />
      </svg>
    </button>
  )
}
