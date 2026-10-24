// The Mood lab's switches: each open choice of the Phase 5 plan's Part A (and B2), numbered by its
// decision, with the option the plan recommends first and picked from the start. The lab keeps
// every pick in the address, so a link opens the same view and a reload keeps it. A14, the wording,
// is approved in its own section.
import { LAB_ERAS, type EraId } from './titles.ts'

export type Options = {
  a1: 'page' | 'discover' | 'both'
  a2: 'link' | 'teaser' | 'unchanged'
  a3: 'door' | 'header' | 'fifth'
  a4: 'three' | 'two'
  a4reset: 'offzero' | 'always'
  a5: 'tap' | 'drag'
  a6: 'tanh' | 'raw'
  a7count: '8' | '6' | '12' | 'none'
  a7move: 'instant' | 'slide'
  a7listed: 'stay' | 'hide'
  a7dome: 'on' | 'off'
  a8: 'why' | 'matched' | 'stickers'
  a9style: 'f1' | 'f2' | 'f3'
  a9time: '700' | '450' | '900'
  a9edge: 'off' | 'on'
  a9press: 'finish' | 'roll'
  a10lever: 'roll' | 'again' | 'pull'
  a10card: 'full' | 'compact'
  a11: 'show' | 'hide'
  a11rule: 'never' | 'luck'
  a12pick: 'top12' | 'next' | 'weighted'
  a12spent: 'repeat' | 'empty'
  a13: 'discover' | 'any' | '2010s'
  b2: 'allowed' | 'skip' | 'first'
}

/** The lab's sections, in order. */
export const SECTIONS = [
  { key: 'mood', name: '1. Mood Matcher' },
  { key: 'doors', name: '2. Discover and doors' },
  { key: 'wording', name: '3. Wording' },
] as const
export type Section = (typeof SECTIONS)[number]['key']

export type Switch = {
  key: keyof Options
  /** The plan's decision it answers, such as A7. */
  decision: string
  legend: string
  options: { value: string; label: string; recommended?: boolean }[]
  /** What the choice weighs, in a sentence or two. */
  note: string
  /**
   * Set where the plan leaves the choice open until a later finding (B2, until the sequel probe):
   * no option is marked recommended, and the first, the working default, carries this badge.
   */
  undecided?: string
  /** Where it shows. */
  section: Section
}

export const SWITCHES: Switch[] = [
  {
    key: 'a1',
    decision: 'A1',
    legend: 'Where the mood matcher lives',
    options: [
      { value: 'page', label: 'Its own page at /mood', recommended: true },
      { value: 'discover', label: 'The sliders on Discover’s machine' },
      { value: 'both', label: 'Both' },
    ],
    note: 'The /mood page follows the spec’s route and core flow 1, and its pool request goes out only for people who open it. On Discover, every visitor who reaches the machine would cost a pool request, and the spec’s ranked matches get squeezed to a top 3. Compare the Tab-stop counter on each.',
    section: 'mood',
  },
  {
    key: 'a2',
    decision: 'A2',
    legend: 'Discover’s pull after Phase 5',
    options: [
      { value: 'link', label: 'Vibe chips, with a “Fine-tune it” link', recommended: true },
      { value: 'teaser', label: 'A teaser with an “Open the Mood Matcher” button' },
      { value: 'unchanged', label: 'Unchanged, no link' },
    ],
    note: 'With the link, Discover keeps its quick pull, which learns to skip My List and your last 30 pulls (PR 2). The teaser takes pulling off Discover.',
    section: 'doors',
  },
  {
    key: 'a3',
    decision: 'A3',
    legend: 'How people reach /mood',
    options: [
      {
        value: 'door',
        label: 'The pull hint’s link and the search empty state',
        recommended: true,
      },
      { value: 'header', label: 'The header’s Pull becomes Mood (ムード)' },
      { value: 'fifth', label: 'A fifth header link' },
    ],
    note: 'The doors leave the dock’s flight and the Tab walks as you signed them off. The header options rework the dock at 900 and 1100 px. The lab shows the header as it is once docked, and does not run the intro’s dock or its flight, so judge the header alone: try the 900 and 1100 widths.',
    section: 'doors',
  },
  {
    key: 'a4',
    decision: 'A4',
    legend: 'The sliders',
    options: [
      { value: 'three', label: 'Three: Energy, Tone, Complexity', recommended: true },
      { value: 'two', label: 'Two, without Complexity' },
    ],
    note: 'In the recorded titles Tone and Complexity move together (correlation 0.64 on their squashed scores; the plan measured 0.62). Feel whether Complexity still changes the matches.',
    section: 'mood',
  },
  {
    key: 'a4reset',
    decision: 'A4',
    legend: '“Reset moods”',
    options: [
      {
        value: 'offzero',
        label: 'Shows only when a slider is off No preference',
        recommended: true,
      },
      { value: 'always', label: 'Always shows' },
    ],
    note: 'Either way its room is kept, so nothing moves as it comes and goes.',
    section: 'mood',
  },
  {
    key: 'a5',
    decision: 'A5',
    legend: 'Slider feel on an iPhone',
    options: [
      { value: 'tap', label: 'A tap on the track jumps to that stop', recommended: true },
      { value: 'drag', label: 'Drag only, as Safari does' },
    ],
    note: 'Try both on your iPhone. The tap sets the value but never focuses the slider from code (WebKit bug 266283). A laptop’s click already jumps.',
    section: 'mood',
  },
  {
    key: 'a6',
    decision: 'A6',
    legend: 'How scores meet the sliders',
    options: [
      { value: 'tanh', label: 'The tanh squash, 2 × tanh(score / 1.5)', recommended: true },
      { value: 'raw', label: 'The spec’s distance on raw scores' },
    ],
    note: 'Raw scores past the scale’s end all tie: 54 recorded titles tie at Very high-octane. Turn on “Show scores” to see each title’s three.',
    section: 'mood',
  },
  {
    key: 'a7count',
    decision: 'A7',
    legend: 'How many top matches',
    options: [
      { value: '8', label: '8', recommended: true },
      { value: '6', label: '6' },
      { value: '12', label: '12' },
      { value: 'none', label: 'None' },
    ],
    note: 'Each sits in a fixed slot, with its cover, rarity sticker and a one-line Why.',
    section: 'mood',
  },
  {
    key: 'a7move',
    decision: 'A7',
    legend: 'When a slider moves',
    options: [
      { value: 'instant', label: 'The list reorders at once', recommended: true },
      { value: 'slide', label: 'A 200 ms slide (none under Reduce motion)' },
    ],
    note: 'Instant reads best when you step through stops with the arrow keys.',
    section: 'mood',
  },
  {
    key: 'a7listed',
    decision: 'A7',
    legend: 'Titles already on My List',
    options: [
      { value: 'stay', label: 'Stay in the row', recommended: true },
      { value: 'hide', label: 'Are hidden' },
    ],
    note: 'Rolls skip them either way. Press “Put 20 matches on My List” to see it.',
    section: 'mood',
  },
  {
    key: 'a7dome',
    decision: 'A7',
    legend: 'The dome’s 9 capsules',
    options: [
      { value: 'on', label: 'Take the top 9 matches’ colors', recommended: true },
      { value: 'off', label: 'Stay as they are' },
    ],
    note: 'A slider move then shows in the dome at once, with no new markup.',
    section: 'mood',
  },
  {
    key: 'a8',
    decision: 'A8',
    legend: 'The Why line',
    options: [
      { value: 'why', label: '“Why: Iyashikei · Episodic”', recommended: true },
      { value: 'matched', label: '“Matched on Iyashikei and Episodic.”' },
      { value: 'stickers', label: 'Two tag stickers in the title’s color' },
    ],
    note: 'Two non-spoiler tags that push hardest toward your sliders, falling back to a genre; hidden when every slider is at No preference. Spoiler tags count but are never named: turn on “Spoiler check”. A title with nothing at a slider’s end can still rank (Hunter x Hunter in the 1990s at Complexity “Pure popcorn”): its Why is then empty. Say whether an empty line is fine.',
    section: 'mood',
  },
  {
    key: 'a9style',
    decision: 'A9',
    legend: 'The flip',
    options: [
      { value: 'f1', label: 'F1: the capsule drops, pops, and the card flips', recommended: true },
      { value: 'f2', label: 'F2: the card flip alone' },
      { value: 'f3', label: 'F3: today’s capsule, no flip' },
    ],
    note: 'Under Reduce motion every option is a 150 ms crossfade, and the lever stays still.',
    section: 'mood',
  },
  {
    key: 'a9time',
    decision: 'A9',
    legend: 'Its timing',
    options: [
      { value: '700', label: '700 ms (drop 250, open 150, flip 300)', recommended: true },
      { value: '450', label: '450 ms' },
      { value: '900', label: '900 ms' },
    ],
    note: 'You will roll 20 times in a row: press “Roll 20” to feel it.',
    section: 'mood',
  },
  {
    key: 'a9edge',
    decision: 'A9',
    legend: 'A rarity glow on the card’s back before it turns',
    options: [
      { value: 'off', label: 'Off', recommended: true },
      { value: 'on', label: 'On' },
    ],
    note: 'On reads like a loot box. Shown with F1 and F2.',
    section: 'mood',
  },
  {
    key: 'a9press',
    decision: 'A9',
    legend: 'A second press while the card flips',
    options: [
      {
        value: 'finish',
        label: 'Finishes the flip at once and rolls nothing',
        recommended: true,
      },
      { value: 'roll', label: 'Finishes the flip and starts the next roll at once' },
    ],
    note: 'Neither ever queues a roll. The plan’s A9 says the first; its PR 4 says the second. Press the lever twice quickly to feel each.',
    section: 'mood',
  },
  {
    key: 'a10lever',
    decision: 'A10',
    legend: 'The lever',
    options: [
      {
        value: 'roll',
        label: '“Roll!” then “Again!”, named “Roll a random anime”',
        recommended: true,
      },
      { value: 'again', label: '“Roll!” then “Roll again!”, the same name' },
      { value: 'pull', label: '“Pull!” wording, as on Discover' },
    ],
    note: 'The spec names the button “Roll a random anime”. Discover’s quick pull keeps “Pull!”. After the first roll, “Again!” is not in that name, which WCAG 2.5.3 (Label in Name) asks for, so voice control’s “Click Again” finds nothing; “Roll again!” starts with the name’s first word.',
    section: 'mood',
  },
  {
    key: 'a10card',
    decision: 'A10',
    legend: 'The rolled card',
    options: [
      {
        value: 'full',
        label: 'Full: the real My List row, Details, Roll again',
        recommended: true,
      },
      { value: 'compact', label: 'Compact: one Save button, Details, Roll again' },
    ],
    note: 'After a roll, focus stays on the lever; closing Details returns focus to Details.',
    section: 'mood',
  },
  {
    key: 'a11',
    decision: 'A11',
    legend: 'Rarity',
    options: [
      { value: 'show', label: 'SSR, SR, R and ? Mystery, with a one-line rule', recommended: true },
      { value: 'hide', label: 'Hidden on /mood' },
    ],
    note: 'SSR is a score of 85 and up, SR 75 to 84, R under 75, Mystery no score. Never odds, streaks or countdowns.',
    section: 'mood',
  },
  {
    key: 'a11rule',
    decision: 'A11',
    legend: 'The rule’s wording',
    options: [
      {
        value: 'never',
        label: '“Rarity is just the AniList score. It never changes what you roll.”',
        recommended: true,
      },
      { value: 'luck', label: '“Rarity is the AniList score, not luck.”' },
    ],
    note: 'Under the rolled card.',
    section: 'mood',
  },
  {
    key: 'a12pick',
    decision: 'A12',
    legend: 'How a roll picks',
    options: [
      { value: 'top12', label: 'At random among the 12 best matches left', recommended: true },
      { value: 'next', label: 'Always the next-best match' },
      { value: 'weighted', label: 'The whole pool, weighted by match' },
    ],
    note: 'With no slider set, every option picks among all the titles left. Page 3 of the era would be fetched once when fewer than 10 can come up: the lab shows it as a simulated request.',
    section: 'mood',
  },
  {
    key: 'a12spent',
    decision: 'A12',
    legend: 'When only your recent rolls are left',
    options: [
      { value: 'repeat', label: 'Repeats start from the oldest, with a line', recommended: true },
      { value: 'empty', label: 'The empty line at once' },
    ],
    note: 'Pick the “Repeat” state, or roll through a thin era, to see it.',
    section: 'mood',
  },
  {
    key: 'a13',
    decision: 'A13',
    legend: 'The era /mood opens on',
    options: [
      {
        value: 'discover',
        label: 'The decade last picked on Discover (else the 1990s)',
        recommended: true,
      },
      { value: 'any', label: 'A ninth chip, “Any era”' },
      { value: '2010s', label: 'Always the 2010s' },
    ],
    note: 'Upcoming stays a chip: unreleased titles have no score, so every roll there is a Mystery.',
    section: 'mood',
  },
  {
    key: 'b2',
    decision: 'B2',
    legend: 'Sequels',
    options: [
      { value: 'allowed', label: 'Allowed' },
      { value: 'skip', label: 'Skipped while another season came up in your last 30' },
      { value: 'first', label: 'First seasons only' },
    ],
    note: 'Not recommended yet: the plan picks (a) only if under about 15% of a real pool are sequels, else (b), and the main session’s probe (REC-5) counts that. “Allowed” is only the working default. The lab’s guess from the titles is near the line on older decades and well over it on trending: 3 of 19 on the 1980s page, 2 of 19 on the 1990s page, 8 of 19 trending. “Roll 20” marks sequels.',
    section: 'mood',
    undecided: 'Decided after the probe',
  },
]

/** Each switch's first option: the recommended one, or the working default while undecided. */
export const DEFAULTS = Object.fromEntries(
  SWITCHES.map(({ key, options }) => [key, options[0].value]),
) as Options

/** The states the Mood page can be put in (none of these is a decision). */
export const STATES = [
  ['ready', 'Ready'],
  ['loading', 'Loading'],
  ['outage', 'AniList unreachable'],
  ['offline', 'Offline, nothing cached'],
  ['limited', 'Rate limited'],
  ['few', 'Few left'],
  ['repeat', 'Repeat'],
  ['empty', 'Empty'],
] as const
export type State = (typeof STATES)[number][0]

/** What the lab shows besides the choices. */
export type Lab = {
  section: Section
  /** The stage's width: the room there is, or a fixed width. */
  width: 'fit' | '280' | '390' | '768' | '900' | '1100' | '1440'
  state: State
  motion: 'full' | 'reduce'
  /** The decade last picked on Discover, for A13 (a). */
  last: EraId
  /** The debug view of each title's scores, and the spoiler check. */
  scores: 'off' | 'on'
  spoilers: 'off' | 'on'
  /** Top matches with one title per franchise (the recordings repeat a few franchises). */
  franchise: 'all' | 'one'
}

export const LAB_DEFAULTS: Lab = {
  section: 'mood',
  width: 'fit',
  state: 'ready',
  motion: 'full',
  last: '1990s',
  scores: 'off',
  spoilers: 'off',
  franchise: 'all',
}

const LAB_VALUES: { [K in keyof Lab]: readonly string[] } = {
  section: SECTIONS.map(({ key }) => key),
  width: ['fit', '280', '390', '768', '900', '1100', '1440'],
  state: STATES.map(([key]) => key),
  motion: ['full', 'reduce'],
  last: LAB_ERAS.filter(({ id }) => id !== 'any').map(({ id }) => id),
  scores: ['off', 'on'],
  spoilers: ['off', 'on'],
  franchise: ['all', 'one'],
}

/** The choices and the lab's state in the address, where they name a known value. */
export function read(search: URLSearchParams): { options: Options; lab: Lab } {
  const options = Object.fromEntries(
    SWITCHES.map(({ key, options }) => {
      const asked = search.get(key)
      return [key, options.some(({ value }) => value === asked) ? asked : DEFAULTS[key]]
    }),
  ) as Options
  const lab = { ...LAB_DEFAULTS }
  for (const key of Object.keys(LAB_VALUES) as (keyof Lab)[]) {
    const asked = search.get(key)
    if (asked !== null && LAB_VALUES[key].includes(asked)) Object.assign(lab, { [key]: asked })
  }
  return { options, lab }
}

/** The address's query for these choices and this state, leaving out what is as it starts. */
export function write(options: Options, lab: Lab, extra: Record<string, string> = {}) {
  const search = new URLSearchParams({ proto: 'mood' })
  for (const { key } of SWITCHES) if (options[key] !== DEFAULTS[key]) search.set(key, options[key])
  for (const key of Object.keys(LAB_DEFAULTS) as (keyof Lab)[])
    if (lab[key] !== LAB_DEFAULTS[key]) search.set(key, String(lab[key]))
  for (const [key, value] of Object.entries(extra)) search.set(key, value)
  return `?${search}`
}
