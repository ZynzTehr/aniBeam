import type { SyntheticEvent } from 'react'

/**
 * Every cover's onError. AniList's image server can be out of reach while its API still answers
 * (a school or office filter, a dropped connection), and Chrome then draws a broken-image icon in
 * the cover's box, even with alt="". data-broken lets components.css hide the image and show
 * what's behind it instead, such as the title's color on a trending panel.
 */
export const markBroken = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.dataset.broken = ''
  delete event.currentTarget.dataset.loaded
}

/**
 * Every cover's onLoad, beside markBroken. The same img can load another file after one failed:
 * from 900px wide the splash panel shows its title's banner and below that its cover, so
 * narrowing the window swaps one for the other, and a refresh can bring a cover's new address.
 * The mark belongs to the file that failed, so one that loads clears it and the cover shows.
 * data-loaded marks a file that has loaded, for what waits for one, such as the title card's
 * banner (see .ab-band img in components.css).
 */
export const markLoaded = (event: SyntheticEvent<HTMLImageElement>) => {
  delete event.currentTarget.dataset.broken
  event.currentTarget.dataset.loaded = ''
}
