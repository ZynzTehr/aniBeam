import type { Lab, Options } from './switches.ts'
import { countLine, DOORS, LEVER, LINES, PAGE, RULES, statusLine } from './wording.ts'

/** Goes to a section of the lab, with any state and choices, loaded again. */
export type GoTo = (patch: Partial<Lab>, picks?: Partial<Options>) => void

type Row = {
  text: string
  where: string
  /** Where "See it" goes: the section, with any state and choices. */
  lab?: Partial<Lab>
  picks?: Partial<Options>
}

const MOOD: Partial<Lab> = { section: 'mood', state: 'ready' }
const DOOR: Partial<Lab> = { section: 'doors' }

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: 'The page',
    rows: [
      {
        text: `${PAGE.heading} ${PAGE.sfx}`,
        where: 'The heading, with its sound effect',
        lab: MOOD,
      },
      { text: PAGE.title, where: 'The page’s title, in the browser’s tab' },
      { text: PAGE.group, where: 'The sliders’ group, read by a screen reader only', lab: MOOD },
      { text: PAGE.reset, where: 'Under the sliders, once one is off No preference', lab: MOOD },
    ],
  },
  {
    title: 'The lever and the status line',
    rows: [
      {
        text: `${LEVER.roll.first} / ${LEVER.roll.again}`,
        where: 'The lever, before and after the first roll (A10)',
        lab: MOOD,
      },
      {
        text: `${LEVER.again.first} / ${LEVER.again.again}`,
        where: 'Or, A10’s other wording, which keeps the name’s first word in view (WCAG 2.5.3)',
        lab: MOOD,
        picks: { a10lever: 'again' },
      },
      { text: LEVER.roll.name ?? '', where: 'The lever’s name for screen readers', lab: MOOD },
      {
        text: `${countLine(0, false)} / ${countLine(7, false)}`,
        where: 'Under the lever (Discover’s says “pulls”)',
        lab: MOOD,
      },
      {
        text: statusLine(7, 'Mushishi', 'SSR'),
        where: 'The status line, read once as the card shows',
        lab: MOOD,
      },
      { text: RULES.never, where: 'The rarity rule under the card (A11)', lab: MOOD },
      { text: RULES.luck, where: 'Or, A11’s other wording', lab: MOOD, picks: { a11rule: 'luck' } },
      { text: 'Details / Roll again', where: 'The rolled card’s buttons', lab: MOOD },
    ],
  },
  {
    title: 'The matches',
    rows: [
      { text: PAGE.top, where: 'The heading, once a slider is set', lab: MOOD },
      { text: PAGE.popular('the 1990s'), where: 'The heading with no slider set', lab: MOOD },
      { text: 'Very cozy · Dark', where: 'Under the heading: the set sliders’ words', lab: MOOD },
      { text: 'Why: Iyashikei · Episodic', where: 'Each match’s Why line (A8 a)', lab: MOOD },
      {
        text: 'Matched on Iyashikei and Episodic.',
        where: 'Or A8 (b)',
        lab: MOOD,
        picks: { a8: 'matched' },
      },
    ],
  },
  {
    title: 'The states',
    rows: [
      { text: LINES.loading, where: 'Loading', lab: { ...MOOD, state: 'loading' } },
      { text: LINES.outage(12), where: 'AniList out of reach', lab: { ...MOOD, state: 'outage' } },
      {
        text: LINES.offline,
        where: 'Offline with nothing saved (the site’s own line); sliders and lever off',
        lab: { ...MOOD, state: 'offline' },
      },
      {
        text: LINES.limited,
        where: 'Rate limited (the site’s shared line)',
        lab: { ...MOOD, state: 'limited' },
      },
      { text: LINES.few(15), where: 'Few left', lab: { ...MOOD, state: 'few' } },
      { text: LINES.repeat, where: 'Only recent rolls left', lab: { ...MOOD, state: 'repeat' } },
      { text: LINES.empty, where: 'Empty, from the spec', lab: { ...MOOD, state: 'empty' } },
    ],
  },
  {
    title: 'The doors',
    rows: [
      { text: DOORS.hint, where: 'Discover’s pull hint (A2 a)', lab: DOOR },
      { text: DOORS.search('q'), where: 'The search’s empty state (spec §3E)', lab: DOOR },
      {
        text: DOORS.allListed,
        where: 'Discover’s line when every title in the machine is listed',
        lab: DOOR,
      },
      {
        text: DOORS.teaser,
        where: 'The teaser’s button (A2 b only)',
        lab: DOOR,
        picks: { a2: 'teaser' },
      },
      {
        text: `Mood · ${DOORS.menu}`,
        where: 'The header’s link and the menu’s katakana (A3 b or c only)',
        lab: DOOR,
        picks: { a3: 'header' },
      },
    ],
  },
]

/** Section 3: every string of the Mood page and its doors, for one-pass approval (A14). */
export function Wording({ goTo }: { goTo: GoTo }) {
  return (
    <div className="ab-lab-text">
      <h2 className="ab-lab-legend">A14: the wording, approved in one pass</h2>
      <p className="ab-lab-why">
        Every string the Mood page and its doors add, where it shows. “See it” opens the stage
        there. Strings marked as the site’s own are already approved.
      </p>
      {GROUPS.map(({ title, rows }) => (
        <section key={title} className="ab-lab-group" aria-label={title}>
          <h3 className="ab-lab-legend">{title}</h3>
          <ul className="ab-lab-words">
            {rows.map((row) => (
              <li key={`${row.text}-${row.where}`}>
                <q className="ab-lab-string">{row.text}</q>
                <span className="ab-lab-why">{row.where}</span>
                {row.lab && (
                  <button
                    type="button"
                    className="ab-lab-see"
                    onClick={() => goTo(row.lab!, row.picks)}
                  >
                    See it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
