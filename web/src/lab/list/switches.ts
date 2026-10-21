// The My List lab's switches: each open choice of the Phase 4 plan's Part A, numbered by its
// decision (D1 to D13; D14, the wording, is approved in its own section), with the option the plan
// recommends first and picked from the start. The lab keeps every pick in the address, so a link
// opens the same view and a reload keeps it.

export type Options = {
  d1: 'pair' | 'three'
  d2: 'adds' | 'waits'
  d3layout: 't2' | 't1'
  d3look: 'hot' | 'stamp'
  d3label: 'save' | 'saved'
  d4: 'n' | 'a' | 'b'
  d5: 'l2' | 'l1'
  d6: 'card' | 'link'
  d7: 'inline' | 'toast' | 'none'
  d8order: 'fixed' | 'select'
  d8label: 'changed' | 'addedAt' | 'added'
  d9: 'links' | 'tabs'
  d10: 'fifty' | 'more'
  d11: 'discover' | 'hide'
  d12: 'none' | 'count'
  d13: 'later' | 'now'
}

/** The lab's sections, in order. */
export const SECTIONS = [
  { key: 'card', name: '1. Title card' },
  { key: 'covers', name: '2. Covers' },
  { key: 'page', name: '3. My List page' },
  { key: 'header', name: '4. Header and intro' },
  { key: 'pull', name: '5. Pull result' },
  { key: 'wording', name: '6. Wording' },
] as const
export type Section = (typeof SECTIONS)[number]['key']

export type Switch = {
  key: keyof Options
  /** The plan's decision it answers, such as D3. */
  decision: string
  legend: string
  options: { value: string; label: string; recommended?: boolean }[]
  /** What the choice weighs, in a sentence or two. */
  note: string
  /** Where it shows. */
  section: Section
}

export const SWITCHES: Switch[] = [
  {
    key: 'd1',
    decision: 'D1',
    legend: 'Saved and Want to try',
    options: [
      { value: 'pair', label: 'One status: two buttons as a pair', recommended: true },
      { value: 'three', label: 'One three-way control' },
    ],
    note: 'The spec’s record has one status per title. As a pair, pressing the other button moves the title, and pressing the pressed one removes it. Being both at once is not offered.',
    section: 'card',
  },
  {
    key: 'd2',
    decision: 'D2',
    legend: 'The heart on a title not on your list',
    options: [
      { value: 'adds', label: 'One press adds it as Saved and Favorite', recommended: true },
      { value: 'waits', label: 'Off until the title is saved' },
    ],
    note: 'Either way, removing a title from the list clears its Favorite too: one entry and one delete marker per title.',
    section: 'card',
  },
  {
    key: 'd3layout',
    decision: 'D3',
    legend: 'Layout on the title card',
    options: [
      { value: 't2', label: 'T2: a “My List” row above the actions', recommended: true },
      { value: 't1', label: 'T1: three buttons in the action row' },
    ],
    note: 'The action row is already tight at 280px: try the 280 width. T2 joins Save and Want to try as a pair, with the heart beside them.',
    section: 'card',
  },
  {
    key: 'd3look',
    decision: 'D3',
    legend: 'Pressed look',
    options: [
      { value: 'hot', label: 'Filled hot red', recommended: true },
      { value: 'stamp', label: 'Ink stamp' },
    ],
    note: 'Hot red uses .ab-btn-hot and --hot-deep, already in the site’s CSS, so it adds the least.',
    section: 'card',
  },
  {
    key: 'd3label',
    decision: 'D3',
    legend: 'Label',
    options: [
      { value: 'save', label: '“Save”', recommended: true },
      { value: 'saved', label: '“Saved”' },
    ],
    note: 'Labels never change when pressed: a screen reader already says “pressed”.',
    section: 'card',
  },
  {
    key: 'd4',
    decision: 'D4',
    legend: 'What covers show',
    options: [
      { value: 'n', label: 'N: covers unchanged in Phase 4', recommended: true },
      { value: 'a', label: 'A: an inked stamp on listed covers (optional PR 4)' },
      { value: 'b', label: 'B: a 44×44 button beside each cover' },
    ],
    note: 'The controls live in the title card, which is both the dialog and the /anime/:id page. A adds no Tab stops; B adds one per cover and needs trending panels 4 and 5 reworked.',
    section: 'covers',
  },
  {
    key: 'd5',
    decision: 'D5',
    legend: 'Editing on the My List page',
    options: [
      { value: 'l2', label: 'L2: covers only, edit in the title card', recommended: true },
      { value: 'l1', label: 'L1: a slim row of buttons under each cover' },
    ],
    note: 'L2 adds no Tab stops and reuses the signed-off card. Open a cover to edit it.',
    section: 'page',
  },
  {
    key: 'd6',
    decision: 'D6',
    legend: 'The spec’s “Track on AniList” link',
    options: [
      { value: 'card', label: 'The card’s “Open on AniList”, one click away', recommended: true },
      { value: 'link', label: 'A visible link under each cover' },
    ],
    note: 'Needed under each cover if you pick L1.',
    section: 'page',
  },
  {
    key: 'd7',
    decision: 'D7',
    legend: 'Undo after removing a title on My List',
    options: [
      { value: 'inline', label: 'Inline in the cover’s place, no timer', recommended: true },
      { value: 'toast', label: 'A toast with Undo and a timer' },
      { value: 'none', label: 'No Undo' },
    ],
    note: 'The inline slot takes focus and stays until you change tab or filter or leave. A timed toast fails WCAG’s rule on time limits. Remove a title from its card (or its L1 row) to try it.',
    section: 'page',
  },
  {
    key: 'd8order',
    decision: 'D8',
    legend: 'Order',
    options: [
      { value: 'fixed', label: 'One fixed order, no sort select', recommended: true },
      { value: 'select', label: 'A sort select' },
    ],
    note: 'The order never changes while you look: My List takes its titles when it opens.',
    section: 'page',
  },
  {
    key: 'd8label',
    decision: 'D8',
    legend: 'The order’s name',
    options: [
      { value: 'changed', label: '“Recently changed”', recommended: true },
      { value: 'addedAt', label: '“Recently added”, with a new addedAt field' },
      { value: 'added', label: '“Recently added”, a small mismatch' },
    ],
    note: 'The order is by updatedAt, the last change: a heart or an Undo moves a title to the front on your next visit. addedAt is outside the spec’s record.',
    section: 'page',
  },
  {
    key: 'd9',
    decision: 'D9',
    legend: 'Tabs and the favorites filter',
    options: [
      { value: 'links', label: 'Links that update the address', recommended: true },
      { value: 'tabs', label: 'ARIA tabs, moved with the arrow keys' },
    ],
    note: 'As links, Back and Forward work and a view can be shared: the address line under the tabs shows what the site’s address would be.',
    section: 'page',
  },
  {
    key: 'd10',
    decision: 'D10',
    legend: 'More than 50 titles',
    options: [
      { value: 'fifty', label: 'The 50 most recent, with a note', recommended: true },
      { value: 'more', label: 'A “Show more” button' },
    ],
    note: 'AniList gives at most 50 a page. Each “Show more” costs one more request. Press “Fill 60” to see it.',
    section: 'page',
  },
  {
    key: 'd11',
    decision: 'D11',
    legend: 'Typing in the header search on My List',
    options: [
      { value: 'discover', label: 'Go to Discover and show results there', recommended: true },
      { value: 'hide', label: 'Hide the search on My List' },
    ],
    note: 'Type in the header’s search on the My List page to try it.',
    section: 'page',
  },
  {
    key: 'd12',
    decision: 'D12',
    legend: 'A count on the header’s My List link',
    options: [
      { value: 'none', label: 'No count', recommended: true },
      { value: 'count', label: '“My List 12”' },
    ],
    note: 'A number that changes width moves the header, and the intro’s dock lines its buttons up by their measured places. Section 4 shows both side by side.',
    section: 'header',
  },
  {
    key: 'd13',
    decision: 'D13',
    legend: 'The pull skipping titles on your list',
    options: [
      { value: 'later', label: 'Wait for Phase 5’s new pool', recommended: true },
      { value: 'now', label: 'Now: prefer titles not listed (optional PR 4)' },
    ],
    note: 'Today’s pool is about 30 titles and would empty fast. The Save group on the pull result (shown here) is optional PR 4 or Phase 5.',
    section: 'pull',
  },
]

/** Each switch's first option: the recommended one. */
export const DEFAULTS = Object.fromEntries(
  SWITCHES.map(({ key, options }) => [key, options[0].value]),
) as Options

/** What the lab shows besides the choices: none of these is a decision. */
export type Lab = {
  section: Section
  /** The stage's width: the room there is, or a fixed width. */
  width: 'fit' | '280' | '390' | '768' | '1440'
  /** The title on the card. */
  title: number
  /** The My List page's state. */
  state: 'list' | 'loading' | 'offline' | 'offline-empty' | 'outage' | 'missing'
  /** What saving does: works, the device's storage is full, or the list is at its cap. */
  storage: 'works' | 'full' | 'cap'
  motion: 'full' | 'reduce'
}

export const LAB_DEFAULTS: Lab = {
  section: 'card',
  width: 'fit',
  title: 154587,
  state: 'list',
  storage: 'works',
  motion: 'full',
}

const LAB_VALUES: { [K in keyof Lab]: readonly string[] } = {
  section: SECTIONS.map(({ key }) => key),
  width: ['fit', '280', '390', '768', '1440'],
  title: [],
  state: ['list', 'loading', 'offline', 'offline-empty', 'outage', 'missing'],
  storage: ['works', 'full', 'cap'],
  motion: ['full', 'reduce'],
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
    if (asked === null) continue
    if (key === 'title') lab.title = /^[1-9]\d{0,8}$/.test(asked) ? Number(asked) : lab.title
    else if (LAB_VALUES[key].includes(asked)) Object.assign(lab, { [key]: asked })
  }
  return { options, lab }
}

/** The address's query for these choices and this state, leaving out what is as it starts. */
export function write(options: Options, lab: Lab, extra: Record<string, string> = {}) {
  const search = new URLSearchParams({ proto: 'list' })
  for (const { key } of SWITCHES) if (options[key] !== DEFAULTS[key]) search.set(key, options[key])
  for (const key of Object.keys(LAB_DEFAULTS) as (keyof Lab)[])
    if (lab[key] !== LAB_DEFAULTS[key]) search.set(key, String(lab[key]))
  for (const [key, value] of Object.entries(extra)) search.set(key, value)
  return `?${search}`
}
