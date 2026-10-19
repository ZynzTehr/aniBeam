// The title page's open choices, as PR 11's plan lists them, each with the option the plan
// recommends marked as it marks it. The lab keeps the current pick of each in the address.

export type Options = {
  hero: 'band' | 'sheet'
  phone: 'strip' | 'frame'
}

export type Choice = {
  key: keyof Options
  legend: string
  options: { value: string; label: string; recommended?: boolean }[]
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
      { value: 'band', label: 'Banner band', recommended: true },
      { value: 'sheet', label: 'Today’s sheet' },
    ],
    note: 'The band crosses the top of the sheet in its ink frame, clamp(200px, 25vw, 420px) tall on desktop, with no text on the banner. With no banner, or one that fails to load, an impact frame in the title’s color stands in: the wipe’s speed lines and screentone, no blur. The glow is the wipe the card already opens with (0 KB), not a blurred cover.',
  },
  {
    key: 'phone',
    legend: 'On phones',
    options: [
      { value: 'strip', label: '19:4 banner strip' },
      { value: 'frame', label: 'Impact frame only' },
    ],
    note: 'Below 820px wide, so try it on a phone or a narrow window. The strip downloads the banner; the frame downloads nothing. The saved titles’ banners weigh more than the plan’s estimate of about 120 KB, and each takes 1.3 to 2.8 s in Chrome’s Fast 3G emulation (not a real phone):',
    needs: { key: 'hero', value: 'band', why: 'Only with the banner band.' },
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
