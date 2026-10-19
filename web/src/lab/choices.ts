// The title page's open choices, as PR 11's plan lists them, each with the option the plan
// recommends marked as it marks it. The lab keeps the current pick of each in the address.

export type Options = {
  hero: 'band' | 'sheet'
  phone: 'strip' | 'frame'
  align: 'top' | 'center'
  synopsis: 'full' | 'clamped'
  tags: '8' | 'all'
  staff: 'later' | 'now'
  kanji: 'later' | 'now'
}

export type Choice = {
  key: keyof Options
  legend: string
  options: {
    value: string
    label: string
    /** The option in a word or two, for the line of current picks (see Picks in TitleLab). */
    short: string
    recommended?: boolean
    /** Not a choice the plan leaves open: it does this in PR 12 whatever else is picked. */
    planned?: boolean
  }[]
  /** What the choice weighs, in a sentence or two. */
  note: string
  /** The choice that must be picked for this one to show, if any. */
  needs?: { key: keyof Options; value: string; why: string }
}

export const CHOICES: Choice[] = [
  {
    key: 'hero',
    legend: 'Hero',
    options: [
      { value: 'band', label: 'Banner band', short: 'Band', recommended: true },
      { value: 'sheet', label: 'Today’s sheet', short: 'Sheet' },
    ],
    note: 'The band crosses the top of the sheet in its ink frame, clamp(200px, 25vw, 420px) tall on desktop, with no text on the banner. With no banner, or one that fails to load, an impact frame in the title’s color stands in: the wipe’s speed lines and screentone, no blur. The glow is the wipe the card already opens with (0 KB), not a blurred cover.',
  },
  {
    key: 'phone',
    legend: 'On phones',
    options: [
      { value: 'strip', label: '19:4 banner strip', short: 'strip' },
      { value: 'frame', label: 'Impact frame only', short: 'frame only' },
    ],
    note: 'Below 820px wide, so try it on a phone or a narrow window. The strip downloads the banner; the frame downloads nothing. The saved titles’ banners weigh more than the plan’s estimate of about 120 KB, and each takes 1.3 to 2.8 s in Chrome’s Fast 3G emulation (not a real phone):',
    needs: { key: 'hero', value: 'band', why: 'Only with the banner band.' },
  },
  {
    key: 'align',
    legend: 'Alignment',
    options: [
      { value: 'top', label: 'Top', short: 'top', planned: true },
      { value: 'center', label: 'Centered (today)', short: 'centered' },
    ],
    note: 'Not an open choice: the plan top-aligns the sheet in PR 12 whichever hero you pick, with the synopsis, tags and credits last: they come in a request of their own (PR 13), and a centered sheet moves the cover and title when they arrive. “Details arrive late” replays that.',
  },
  {
    key: 'synopsis',
    legend: 'Synopsis',
    options: [
      { value: 'full', label: 'Full', short: 'full' },
      { value: 'clamped', label: 'Clamped to 5 lines', short: 'clamped' },
    ],
    note: 'AniList’s synopses run from 421 to 1,602 characters on these titles. Clamped, a “Read more” button shows the rest; a screen reader reads it all either way. The “(Source: …)” line becomes a caption in both.',
  },
  {
    key: 'tags',
    legend: 'Tags',
    options: [
      { value: '8', label: 'The top 8 by rank', short: '8 tags', recommended: true },
      { value: 'all', label: 'All of them', short: 'all tags' },
    ],
    note: 'Adult tags are dropped and spoiler tags wait behind “Show spoiler tags” either way (spec §3G). All of them is 75 for One Piece.',
  },
  {
    key: 'staff',
    legend: 'Staff credits',
    options: [
      { value: 'later', label: 'Later', short: 'staff later', recommended: true },
      { value: 'now', label: 'Now: Director and Music', short: 'staff now' },
    ],
    note: 'About 0.5 KB more per title. The saved answers hold AniList’s 6 most relevant credits, which have a Director for 4 of the 6 titles and Music for none, so the lab marks what is missing.',
  },
  {
    key: 'kanji',
    legend: 'Watermark kanji',
    options: [
      {
        value: 'later',
        label: 'Later: a heavy system font',
        short: 'kanji later',
        recommended: true,
      },
      { value: 'now', label: 'Now: Dela Gothic One’s own', short: 'Dela kanji' },
    ],
    note: 'Today the Japanese title behind the cover is in a heavy system font, as the self-hosted Dela subset has kana but no kanji. Here Dela’s own kanji come from a 6.8 KB file of just the 36 kanji and 7 marks the saved titles need; the site would need Google’s split files, 246 of them, about 17 KB per opened card.',
  },
]

/** Each choice's first option: the recommended one where the plan recommends one. */
export const DEFAULTS = Object.fromEntries(
  CHOICES.map(({ key, options }) => [key, options[0].value]),
) as Options

/** The options in the address, where they name one the choice has; the defaults elsewhere. */
export function optionsIn(search: URLSearchParams): Options {
  return Object.fromEntries(
    CHOICES.map(({ key, options }) => {
      const asked = search.get(key)
      return [key, options.some(({ value }) => value === asked) ? asked : DEFAULTS[key]]
    }),
  ) as Options
}
