import type { ReactNode } from 'react'
import { LAB_TITLES } from './pool.ts'
import { addAll, fill60, reset, twelve } from './sandbox.ts'
import type { Lab, Options } from './switches.ts'
import { missingLine, removedFrom, tabName, WORDS } from './wording.ts'

/** Shows a line where it is: a section, what the lab should show, and the stage's own view. */
export type GoTo = (
  section: Lab['section'],
  lab?: Partial<Lab>,
  view?: Record<string, string>,
  options?: Partial<Options>,
) => void

type Line = {
  text: string
  where: ReactNode
  see: () => void
  /** Said when "See it" changes the lab's list. */
  changes?: string
  /** Not in the plan's list: a line the lab found it needs. */
  added?: boolean
}

/**
 * Section 6, D14: every new line, to approve in one pass, each with where it shows and a "See it"
 * that takes the stage there.
 */
export function Wording({ goTo }: { goTo: GoTo }) {
  const groups: { title: string; lines: Line[] }[] = [
    {
      title: 'Buttons',
      lines: [
        {
          text: `${WORDS.save} · ${WORDS.want} · ${WORDS.favorite}`,
          where: 'The title card’s three buttons, with labels that never change.',
          see: () => goTo('card', { storage: 'works' }),
        },
        {
          text: WORDS.group,
          where: 'The group’s name, shown above the buttons in T2 and read by a screen reader.',
          see: () => goTo('card', { storage: 'works' }, {}, { d3layout: 't2' }),
        },
      ],
    },
    {
      title: 'Status lines (read by a screen reader, shown in the lab at the card’s foot)',
      lines: [
        {
          text: WORDS.movedWant,
          where: 'After Want to try on a saved title.',
          see: () => goTo('card', { storage: 'works' }),
        },
        {
          text: WORDS.movedSaved,
          where: 'After Save on a title in Want to try: the plan names only the other way.',
          see: () => goTo('card', { storage: 'works' }),
          added: true,
        },
        {
          text: WORDS.removed,
          where: 'After pressing the pressed status, which takes the title off.',
          see: () => goTo('card', { storage: 'works' }),
        },
        {
          text: WORDS.kept,
          where: 'When the device won’t save: press any button with Saving on “Storage full”.',
          see: () => goTo('card', { storage: 'full' }),
        },
        {
          text: WORDS.full,
          where: 'At 2,000 titles, an add changes nothing: press Save with “At the 2,000 cap”.',
          see: () => goTo('card', { storage: 'cap' }),
        },
      ],
    },
    {
      title: 'The My List page',
      lines: [
        {
          text: `${tabName(WORDS.saved, 12)} · ${tabName(WORDS.want, 3)}`,
          where: 'The tabs, with their counts.',
          see: () => {
            twelve()
            goTo('page', { state: 'list' })
          },
          changes: 'puts twelve titles on the lab’s list',
        },
        {
          text: WORDS.favoritesOnly,
          where: 'The filter beside the tabs.',
          see: () => goTo('page', { state: 'list' }),
        },
        {
          text: 'Order: Recently changed',
          where: 'Under the tabs (D8).',
          see: () => goTo('page', { state: 'list' }),
        },
        {
          text: `${WORDS.emptySaved} · ${WORDS.emptyWant} · ${WORDS.browse}`,
          where: 'An empty tab, with a way on.',
          see: () => {
            reset()
            goTo('page', { state: 'list' })
          },
          changes: 'empties the lab’s list',
        },
        {
          text: `${WORDS.emptyFavorites} · ${WORDS.showAll}`,
          where: 'Favorites only, with no favorites in the tab.',
          see: () => {
            reset()
            addAll(LAB_TITLES)
            goTo('page', { state: 'list' }, { fav: '1' })
          },
          changes: 'puts six titles, none a favorite, on the lab’s list',
        },
        {
          text: `${removedFrom(WORDS.saved)} ${WORDS.undo}`,
          where: 'In a removed cover’s place (D7): open a cover and press Save.',
          see: () => goTo('page', { state: 'list' }, {}, { d7: 'inline' }),
        },
        {
          text: `${missingLine(2)} ${WORDS.removeThem}`,
          where: 'When AniList’s answer leaves out titles on the list (here one: “1 title …”).',
          see: () => goTo('page', { state: 'missing' }),
        },
        {
          text: WORDS.fifty,
          where: 'Past 50 titles (D10).',
          see: () => {
            fill60()
            goTo('page', { state: 'list' })
          },
          changes: 'fills the lab’s list with 60',
        },
        {
          text: WORDS.browserOnly,
          where: 'At the page’s foot. Safari wipes a site’s storage after 7 days without a visit.',
          see: () => goTo('page', { state: 'list' }),
        },
        {
          text: WORDS.offline,
          where: 'Offline, with the titles cached: the site’s existing line.',
          see: () => goTo('page', { state: 'offline' }),
        },
        {
          text: WORDS.unavailableOffline,
          where: 'Offline with nothing cached, on each card.',
          see: () => goTo('page', { state: 'offline-empty' }),
          added: true,
        },
        {
          text: 'Track on AniList',
          where: 'Under each cover with D6’s visible link, or with L1.',
          see: () => goTo('page', { state: 'list' }, {}, { d6: 'link' }),
        },
      ],
    },
    {
      title: 'Elsewhere',
      lines: [
        {
          text: WORDS.kana,
          where: 'Beside My List in the phone menu (proposed): open the menu below 900px.',
          see: () => goTo('header', { width: '390' }),
        },
        {
          text: 'Everything here is on your list. Try another decade.',
          where: 'The pull’s hint when every title in the machine is listed: only with D13 “now”.',
          see: () => goTo('pull', {}, {}, { d13: 'now' }),
          added: true,
        },
      ],
    },
  ]
  return (
    <div className="ab-lab-wording">
      <h2 className="ab-lab-legend">D14: the wording, to approve in one pass</h2>
      <p className="ab-lab-why">
        Every new line the plan proposes, where it shows, and a button that shows it there. Lines
        marked <span className="ab-lab-rec">Added</span> are ones the lab found it needs.
      </p>
      {groups.map(({ title, lines }) => (
        <section key={title} className="ab-lab-group" aria-label={title}>
          <h3 className="ab-lab-legend">{title}</h3>
          <ul className="ab-lab-lines">
            {lines.map(({ text, where, see, changes, added }) => (
              <li key={text}>
                <q>{text}</q>
                {added && <span className="ab-lab-rec">Added</span>} <span>{where}</span>{' '}
                <button
                  type="button"
                  className="ab-lab-see"
                  aria-label={`See it: ${text}`}
                  onClick={see}
                >
                  See it{changes && ` (${changes})`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
