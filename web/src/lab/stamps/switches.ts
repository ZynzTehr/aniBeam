// The stamps lab's switches, S1 to S8 (see lab-spec.md, section 2), each starting on the option
// the spec recommends, and what the lab shows besides them (the frame's width, motion, the clip
// boxes). Every pick lives in the address, so a link opens the same setup and a reload keeps it.

export type Look = 'a' | 'b' | 'c'

export type Options = {
  /** S1, the look: A folder tab, B ink sticker, C hanko press. */
  s1: Look
  /** S2, the colors, which follow the look: a1 to a3 with A, b1 or b2 with B, c with C. */
  s2: 'a1' | 'a2' | 'a3' | 'b1' | 'b2' | 'c'
  /** S3, the words: SAVED or WANT with a heart, or the heart alone. */
  s3: 'a' | 'b'
  /** S4, the katakana accent. */
  s4: 'off' | 'on'
  /** S5, where the stamp sits on strip and search covers. */
  s5: 'a' | 'b' | 'c'
  /** S6, the surfaces that get stamps, as letters: t, d, s, m and r (see SURFACES). */
  s6: string
  /** S7, how a stamp appears: at once, or with a slam. */
  s7: 'a' | 'b'
  /** S8, the stamps on My List's page. */
  s8: 'a' | 'b' | 'c' | 'd'
}

type Choice<Value extends string> = {
  value: Value
  label: string
  /** The few words the phone's closed sheet shows for it. */
  short: string
  recommended?: boolean
  /** What it is, in a line. */
  note: string
}

/** S6's surfaces, each a letter in the address. */
export const SURFACES = [
  { letter: 't', label: 'Trending page', recommended: true },
  { letter: 'd', label: 'Decade strip', recommended: true },
  { letter: 's', label: 'Search results', recommended: true },
  { letter: 'm', label: 'Top 3 matches', recommended: true },
  { letter: 'r', label: 'Rolled card (after Save beside it)', recommended: false },
] as const

export const LOOKS: Choice<Look>[] = [
  {
    value: 'a',
    label: 'A. Folder tab',
    short: 'Folder tab',
    recommended: true,
    note: 'A small white tab growing out of the top ink line of the caption or title box, in hot-red M PLUS caps, with no tilt or shadow.',
  },
  {
    value: 'b',
    label: 'B. Ink sticker',
    short: 'Ink sticker',
    note: 'The rarity pill’s family: a full pill with an ink outline and an ink drop shadow, in Dela Gothic One, tilted -6deg.',
  },
  {
    value: 'c',
    label: 'C. Hanko press',
    short: 'Hanko press',
    note: 'A red double-ring ink stamp with no shadow, in Dela Gothic One, tilted -8deg, on 90% paper, with a lighter right end.',
  },
]

/** S2's options for each look. */
export const COLORS: Record<Look, Choice<Options['s2']>[]> = {
  a: [
    {
      value: 'a1',
      label: 'A1. White tab, red word, red heart',
      short: 'White tab',
      recommended: true,
      note: 'The most legible, and it reads as part of the caption.',
    },
    {
      value: 'a2',
      label: 'A2. Ink tab, white word, red heart',
      short: 'Ink tab',
      note: 'Louder; holds up on busy light art.',
    },
    {
      value: 'a3',
      label: 'A3. Like A1, with a dashed border on WANT',
      short: 'Dashed WANT',
      note: 'The state shows without reading the word.',
    },
  ],
  b: [
    {
      value: 'b2',
      label: 'B2. All white: SAVED in red, WANT in ink',
      short: 'All white',
      recommended: true,
      note: 'A yellow pill beside the yellow rarity sticker reads as a second grade.',
    },
    {
      value: 'b1',
      label: 'B1. Yellow SAVED, white WANT',
      short: 'Yellow SAVED',
      note: 'The designer’s default. On match covers B is always white.',
    },
  ],
  c: [
    {
      value: 'c',
      label: 'One ink',
      short: 'One ink',
      recommended: true,
      note: 'The hanko comes in one ink only, so this switch has nothing to pick with C.',
    },
  ],
}

export type Switch = {
  key: Exclude<keyof Options, 's2' | 's6'>
  num: string
  legend: string
  options: Choice<string>[]
}

export const SWITCHES: Switch[] = [
  { key: 's1', num: 'S1', legend: 'Which look do stamps take?', options: LOOKS },
  {
    key: 's3',
    num: 'S3',
    legend: 'What does a stamp say?',
    options: [
      {
        value: 'a',
        label: 'SAVED or WANT, with a heart for a favorite',
        short: 'Word and heart',
        recommended: true,
        note: 'Four states. A screen reader hears “, saved” or “, want to try”, then “, favorite”.',
      },
      {
        value: 'b',
        label: 'Heart only',
        short: 'Heart only',
        note: 'Only favorites get a stamp. A screen reader hears “, favorite” only.',
      },
    ],
  },
  {
    key: 's4',
    num: 'S4',
    legend: 'A katakana accent after the word?',
    options: [
      {
        value: 'off',
        label: 'Off',
        short: 'No katakana',
        recommended: true,
        note: 'English only.',
      },
      {
        value: 'on',
        label: 'On: セーブ beside SAVED, ミタイ beside WANT',
        short: 'Katakana',
        note: 'Hidden from screen readers; left out on match covers below 414px.',
      },
    ],
  },
  {
    key: 's5',
    num: 'S5',
    legend: 'Where does the stamp sit on strip and search covers?',
    options: [
      {
        value: 'a',
        label: 'On the title box, left',
        short: 'Title box, left',
        recommended: true,
        note: 'The same corner as on trending, so a listed title looks the same everywhere.',
      },
      {
        value: 'b',
        label: 'On the title box, right',
        short: 'Title box, right',
        note: 'The hanko design’s spot.',
      },
      {
        value: 'c',
        label: 'Top right inside the cover’s frame',
        short: 'Cover, top right',
        note: 'Clear of the Ch.N tag, away from the title box. With look A the tab stands free, as a tag, since there is no ink line to grow from.',
      },
    ],
  },
  {
    key: 's7',
    num: 'S7',
    legend: 'How does a stamp appear?',
    options: [
      {
        value: 'a',
        label: 'Instantly',
        short: 'Instant',
        recommended: true,
        note: 'Already there in the cover’s first frame; a change draws a new stamp, so nothing shifts.',
      },
      {
        value: 'b',
        label: 'Stamp-slam',
        short: 'Slam',
        note: 'A stamp whose title changed since the page loaded drops in, 320ms; held while the card is open, so it plays as the card closes. Instant under Reduce motion.',
      },
    ],
  },
  {
    key: 's8',
    num: 'S8',
    legend: 'What do My List’s covers show?',
    options: [
      {
        value: 'a',
        label: 'Only what the page doesn’t already say',
        short: 'What the page doesn’t say',
        recommended: true,
        note: 'The word only when it differs from the tab; the heart only with Favorites only off.',
      },
      {
        value: 'b',
        label: 'Heart only',
        short: 'Hearts',
        note: 'Favorites show a heart; no status word ever.',
      },
      { value: 'c', label: 'No stamps on My List', short: 'None', note: 'Nothing on its covers.' },
      {
        value: 'd',
        label: 'The full stamp everywhere',
        short: 'Full stamp',
        note: 'As on the other surfaces.',
      },
    ],
  },
]

const recommendedOf = <Value extends string>(options: Choice<Value>[]) =>
  (options.find((option) => option.recommended) ?? options[0]).value

/** Every switch on the spec's recommendation. */
export const DEFAULTS: Options = {
  s1: 'a',
  s2: 'a1',
  s3: 'a',
  s4: 'off',
  s5: 'a',
  s6: SURFACES.filter((surface) => surface.recommended)
    .map(({ letter }) => letter)
    .join(''),
  s7: 'a',
  s8: 'a',
}

/** The recommended colors for a look, which S2 moves to when S1 changes. */
export const colorsFor = (look: Look) => recommendedOf(COLORS[look])

/** What the lab shows besides the choices: none of these is a decision. */
export type View = {
  width: 'fit' | '280' | '390' | '768' | '1440'
  motion: 'device' | 'reduce'
  clips: boolean
}

export const VIEW_DEFAULTS: View = { width: 'fit', motion: 'device', clips: false }
export const WIDTHS = ['fit', '280', '390', '768', '1440'] as const

/** The choices and the view the address names, each a known value or its default. */
export function read(search: URLSearchParams): { options: Options; view: View } {
  const options = { ...DEFAULTS }
  for (const { key, options: choices } of SWITCHES) {
    const asked = search.get(key)
    if (choices.some(({ value }) => value === asked)) Object.assign(options, { [key]: asked })
  }
  const s2 = search.get('s2')
  options.s2 = COLORS[options.s1].some(({ value }) => value === s2)
    ? (s2 as Options['s2'])
    : colorsFor(options.s1)
  const s6 = search.get('s6')
  if (s6 !== null)
    options.s6 = SURFACES.map(({ letter }) => letter)
      .filter((letter) => s6.includes(letter))
      .join('')
  const width = search.get('width')
  return {
    options,
    view: {
      width: WIDTHS.find((known) => known === width) ?? VIEW_DEFAULTS.width,
      motion: search.get('motion') === 'reduce' ? 'reduce' : 'device',
      clips: search.get('clips') === '1',
    },
  }
}

/** The address's query for these choices and this view, leaving out what is as it starts. */
export function write(options: Options, view: View, extra: Record<string, string> = {}) {
  const search = new URLSearchParams({ proto: 'stamps' })
  for (const key of Object.keys(DEFAULTS) as (keyof Options)[])
    if (options[key] !== DEFAULTS[key]) search.set(key, options[key])
  if (view.width !== VIEW_DEFAULTS.width) search.set('width', view.width)
  if (view.motion !== VIEW_DEFAULTS.motion) search.set('motion', view.motion)
  if (view.clips) search.set('clips', '1')
  for (const [key, value] of Object.entries(extra)) search.set(key, value)
  return `?${search}`
}

/** "S1 Folder tab, S2 White tab, ...": the setup in a line, for the phone's closed sheet. */
export function summary(options: Options) {
  const parts = [
    `S1 ${LOOKS.find(({ value }) => value === options.s1)!.short}`,
    `S2 ${COLORS[options.s1].find(({ value }) => value === options.s2)!.short}`,
    ...SWITCHES.filter(({ key }) => key !== 's1').map(
      ({ key, num, options: choices }) =>
        `${num} ${choices.find(({ value }) => value === options[key])!.short}`,
    ),
  ]
  parts.splice(5, 0, `S6 ${options.s6.length} of 5 surfaces`)
  return parts.join(', ')
}

/** The lab's sections, in order, each with the small heading the stage gives it. */
export const SECTIONS = [
  'Trending page',
  'Decade strip',
  'Search results',
  'Pull machine: Top 3 and the rolled card',
  'My List',
] as const
