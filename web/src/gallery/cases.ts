// The gallery's edge cases (see Gallery.tsx). Each starts from a real title among the samples
// (samples.ts), so it needs no request, and changes only the fields it names, to a gap a real
// AniList title has. AniList leaves many fields empty, and the samples, all well-loved titles,
// have almost none of those gaps.
import { SAMPLES } from '../features/anime/samples.ts'
import type { Media } from '../features/anime/queries.ts'

export type TitleCase = {
  /** What the case shows, as the gallery labels it. */
  label: string
  /** A real AniList title with the same gap, as the recorded answers in web/e2e/anilist show. */
  like: string
  /** The fields changed, on the sample with this id. */
  from: number
  changes: Partial<Media>
}

const sample = (id: number) => {
  const found = SAMPLES.find((media) => media.id === id)
  if (!found) throw new Error(`No sample has the id ${id}`)
  return found
}

/** A case's title: its sample, with its changes. */
export const mediaOf = ({ from, changes }: TitleCase): Media => ({ ...sample(from), ...changes })

// An image that fails to load at once, with no request: Chrome then draws a broken-image icon,
// as it does when AniList's image server can't be reached.
const BROKEN = 'data:,'
// Tora-chan no Kankan Mushi's real cover, 225 by 124 pixels: wider than it is tall.
const WIDE = 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/10743.jpg'
// An episode that airs in 2 days and 4 hours from when the gallery opens.
const SOON = () => Math.floor(Date.now() / 1000) + (2 * 24 + 4) * 3600

/**
 * The title cases. The first 9 are the ones a trending panel shows, in its order: the gallery puts
 * them on one manga page, the first on the splash panel, which shows a banner from 900px wide.
 */
export const TITLE_CASES: TitleCase[] = [
  {
    label: 'No banner',
    like: 'Black Clover Season 2 (55 of the 194 recorded titles have none)',
    from: 154587,
    changes: { bannerImage: null },
  },
  {
    label: 'A 52-character title',
    like: 'The Exiled Heavy Knight Knows How to Game the System, whose title this is',
    from: 140960,
    changes: {
      title: {
        romaji: 'Tsuihou Sareta Tensei Juukishi wa Game Chishiki de Musou Suru',
        english: 'The Exiled Heavy Knight Knows How to Game the System',
        native: '追放された転生重騎士はゲーム知識で無双する',
      },
    },
  },
  {
    label: 'One long word',
    like: 'Koyomimonogatari, 16 letters with no space',
    from: 130003,
    changes: { title: { romaji: 'Koyomimonogatari', english: null, native: '暦物語' } },
  },
  {
    label: 'No color',
    like: 'Princess Mononoke',
    from: 113415,
    changes: { coverImage: { ...sample(113415).coverImage, color: null } },
  },
  {
    label: 'No score',
    like: 'Ruri Dragon',
    from: 161645,
    changes: { averageScore: null },
  },
  {
    label: 'The small 230px cover',
    like: 'Saint Seiya: Knights of the Zodiac',
    from: 16498,
    changes: {
      coverImage: { ...sample(16498).coverImage, extraLarge: sample(16498).coverImage.large },
    },
  },
  {
    label: 'A cover that fails to load',
    like: 'any cover, while AniList’s image server is out of reach',
    from: 9253,
    changes: { coverImage: { ...sample(9253).coverImage, extraLarge: BROKEN, large: BROKEN } },
  },
  {
    label: 'A wide cover',
    like: 'Tora-chan no Kankan Mushi, whose cover this is',
    from: 20464,
    changes: { coverImage: { ...sample(20464).coverImage, extraLarge: WIDE, large: WIDE } },
  },
  {
    label: 'No genres, studio or episode count',
    like: 'Puzzle & Dragon (no genres), Dragon Ball DAIMA (no studio), ONE PIECE (no count)',
    from: 21827,
    changes: { genres: [], studios: { nodes: [] }, episodes: null },
  },
  {
    label: 'No native title',
    like: 'none of the 194 recorded titles, but AniList allows it',
    from: 199,
    changes: { title: { ...sample(199).title, native: null } },
  },
  {
    label: 'An episode countdown',
    like: 'ONE PIECE',
    from: 5114,
    changes: { nextAiringEpisode: { episode: 9, airingAt: SOON() } },
  },
]

/**
 * A pool where every title is Ecchi, which spec §3G keeps out of the pull: like Ranma ½ and GOLDEN
 * BOY, whose genres on AniList include Ecchi.
 */
export const ECCHI_POOL: Media[] = SAMPLES.slice(0, 9).map((media) => ({
  ...media,
  genres: [...media.genres, 'Ecchi'],
}))
