import { useContext } from 'react'
import type { StampSlot } from '../../components/stampDraw.ts'
import { useEntry } from '../../features/list/store.ts'
import { LabOptions } from './options.ts'
import { stampOf } from './words.ts'

// The heart, as the title card's own (see ListControls).
const HEART =
  'M12 20.5 3.1 11.8a5.3 5.3 0 0 1 0-7.5 5.3 5.3 0 0 1 7.5 0L12 5.7l1.4-1.4a5.3 5.3 0 0 1 7.5 7.5Z'

// S4's katakana, after the English word.
const KANA = { SAVED: 'セーブ', WANT: 'ミタイ' }

/**
 * The lab's stamp in one of a cover's slots (see components/Stamp.tsx), as the switches set it. It
 * reads only its own title's entry (useEntry), so an edit draws again only the covers of the title
 * edited. The visible stamp is hidden from screen readers, which hear its words, at the end of the
 * cover's name, instead; it is keyed by what it shows, so a change draws a new one in its place
 * and nothing grows, which would shift the page.
 */
export function LabStamp({ id, surface, part, page }: StampSlot) {
  const entry = useEntry(id)
  const options = useContext(LabOptions)
  const shown = entry && stampOf(entry, options, surface, page)
  if (!shown) return null
  const free =
    options.s5 === 'c' && (surface === 'strip' || surface === 'search' || surface === 'list')
  const look =
    part === 'both' || part === 'look' || (part === 'title' && !free) || (part === 'cover' && free)
  const words = part === 'both' || part === 'words' || part === 'title'
  const heart = shown.heart && (
    <svg className="ab-lab-heart" viewBox="0 0 24 22">
      <path d={HEART} />
    </svg>
  )
  // The folder tab puts its heart after the word; the sticker and the hanko, before it.
  const heartFirst = options.s1 !== 'a'
  return (
    <>
      {look && (
        <span
          key={`${options.s1}-${shown.key}`}
          className="ab-lab-stamp"
          data-look={options.s1}
          data-tone={options.s2}
          data-status={entry.status.toLowerCase()}
          data-at={surface}
          data-place={free ? 'cover' : options.s5}
          data-fav={shown.heart ? '' : undefined}
          aria-hidden="true"
        >
          {heartFirst && heart}
          {shown.word && <span className="ab-lab-word">{shown.word}</span>}
          {!heartFirst && heart}
          {shown.word && options.s4 === 'on' && (
            <span className="ab-lab-kana" lang="ja">
              {KANA[shown.word]}
            </span>
          )}
        </span>
      )}
      {words && <span className="sr-only">{shown.spoken}</span>}
    </>
  )
}
