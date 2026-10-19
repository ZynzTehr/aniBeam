import type { Media } from '../features/anime/queries.ts'

/** A tag as the lab shows it. One Piece's saved answer has no tag names, so name can be null. */
export type LabTag = { name: string | null; rank: number; spoiler: boolean; adult: boolean }

/**
 * A title with what a title page might add to the list's fields (see titles.ts): its synopsis,
 * trailer, tags and the first six staff credits AniList ranks by relevance, as saved.
 */
export type LabTitle = Media & {
  status: string
  /** As AniList gives it with asHtml: false, which still holds <br>, <i> and <b>. */
  description: string | null
  trailer: { id: string; site: string } | null
  tags: LabTag[]
  /** null where the saved answer holds no staff at all (One Piece). */
  staff: { role: string; name: string }[] | null
  /** The banner's size in bytes, measured once; null with no banner. */
  bannerBytes: number | null
}

/** A title the lab can show: a saved title, or one with a gap forced on it. */
export type LabCase = {
  key: string
  /** Its name in the switcher. */
  label: string
  /** The saved title it starts from. */
  from: number
  /** What the case shows, and what the saved answers lack for it. */
  note: string
  changes?: Partial<LabTitle>
}
