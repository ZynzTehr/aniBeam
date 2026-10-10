import type { SyntheticEvent } from 'react'

/**
 * Every cover's onError. AniList's image server can be out of reach while its API still answers
 * (a school or office filter, a dropped connection), and Chrome then draws a broken-image icon in
 * the cover's box, even with alt="". data-broken lets components.css hide the image and show
 * what's behind it instead, such as the title's color on a trending panel.
 */
export const markBroken = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.dataset.broken = ''
}
