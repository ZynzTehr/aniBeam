import { useEntry } from '../features/list/store.ts'
import { stampOf, type StampPage } from './stamp.ts'

/**
 * A listed title's stamp on its cover (see stampOf): the folder tab, SAVED or WANT with a heart for
 * a favorite, seen but not heard, then its words, heard at the end of the cover's name. Nothing for
 * a title not on the list. `part` draws one of the two alone, where they go in different places: a
 * strip's tab in its title box, and its words after the season. It reads only its own title's entry
 * (useEntry), so an edit draws again only the covers of the title edited; and its tab is keyed by
 * what it shows, so a change draws a new one in its place, and nothing grows, which would shift the
 * page. Inside the cover's link, it adds no Tab stop.
 */
export function Stamp({
  id,
  part,
  page,
}: {
  id: number
  part?: 'tab' | 'words'
  page?: StampPage
}) {
  const shown = stampOf(useEntry(id), page)
  if (!shown) return null
  return (
    <>
      {part !== 'words' && (
        <span key={shown.key} className="ab-stamp" aria-hidden="true">
          {shown.word}
          {shown.heart && (
            // The heart ListControls draws.
            <svg viewBox="0 0 24 22">
              <path d="M12 20.5 3.1 11.8a5.3 5.3 0 0 1 0-7.5 5.3 5.3 0 0 1 7.5 0L12 5.7l1.4-1.4a5.3 5.3 0 0 1 7.5 7.5Z" />
            </svg>
          )}
        </span>
      )}
      {part !== 'tab' && <span className="sr-only">{shown.spoken}</span>}
    </>
  )
}
