// The title lab's cases: the plan's six real titles, as saved, and three with a gap forced on a
// saved title, as the site's component cases do, since none of the 146 titles in the saved
// answers has a broken banner, a missing color or a missing synopsis.
import { TITLES } from './titles.ts'
import type { LabCase, LabTitle } from './types.ts'

const saved = (id: number) => {
  const found = TITLES.find((title) => title.id === id)
  if (!found) throw new Error(`No saved title has the id ${id}`)
  return found
}

/** A case's title: the saved title, with the case's changes. */
export const titleOf = ({ from, changes }: LabCase): LabTitle => ({ ...saved(from), ...changes })

// An image that fails at once, with no request, as a banner does while AniList's image server
// can't be reached.
const BROKEN = 'data:,'

export const CASES: LabCase[] = [
  {
    key: 'frieren',
    label: 'Frieren',
    from: 154587,
    note: 'A banner, a trailer, 28 tags (one a spoiler), and a "(Source: …)" line at the end of its synopsis.',
  },
  {
    key: 'aot',
    label: 'Attack on Titan',
    from: 16498,
    note: '29 tags, 9 of them spoilers. Its saved trailer id ends in a tab, which the lab trims.',
  },
  {
    key: 'bebop',
    label: 'Cowboy Bebop',
    from: 1,
    note: 'A 1998 title with a banner, a trailer and 33 tags (3 spoilers). Its synopsis has no source line.',
  },
  {
    key: 'tokyo',
    label: 'Ten Tokyo Warriors',
    from: 1052,
    note: 'No banner, no trailer and no tags, and its cover is the small 230px one. No Director among its 5 saved credits.',
  },
  {
    key: 'long',
    label: 'The Laid-Off Cheat-Granting Mage…',
    from: 207329,
    note: 'A 62-character title, a 230px cover, a very long Japanese title and a 1,387-character synopsis. Still airing.',
  },
  {
    key: 'onepiece',
    label: 'One Piece',
    from: 21,
    note: '75 tags (18 spoilers) and a 1,602-character synopsis with a bold heading and a list. Its saved answer has no tag names and no staff, so the lab marks both as missing; it has no trailer.',
  },
  {
    key: 'broken',
    label: 'Broken banner',
    from: 16498,
    note: 'Attack on Titan with a banner that fails to load, as while AniList’s image server is out of reach.',
    changes: { bannerImage: BROKEN, bannerBytes: null },
  },
  {
    key: 'nocolor',
    label: 'No color',
    from: 1,
    note: 'Cowboy Bebop without its cover color, like Princess Mononoke on AniList: brand red stands in.',
    changes: { coverImage: { ...saved(1).coverImage, color: null } },
  },
  {
    key: 'nodescription',
    label: 'No synopsis',
    from: 154587,
    note: 'Frieren without a synopsis. None of the 146 saved titles lacks one, so this one is forced.',
    changes: { description: null },
  },
]
