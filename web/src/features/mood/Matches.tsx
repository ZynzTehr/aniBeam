import type { Ref } from 'react'
import { markBroken, markLoaded } from '../../components/cover.ts'
import { opener } from '../../components/opener.ts'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { titlePath } from '../../lib/route.ts'
import { titleOf } from '../anime/format.ts'
import type { Media } from '../anime/queries.ts'
import { accentVars } from '../theming/deriveAccent.ts'
import { rarityOf } from './rarity.ts'

// How many matches the machine shows: a top 3 under the pulled title (the user's pick, D7 a).
const MATCHES = 3

/**
 * The machine's top matches (the plan's D7 and A8): the first of `titles`, each in a fixed slot
 * with its cover, rarity sticker, title and Why line (`why`, the names of what matched), a real
 * link to the title's address that opens its card with no request. Every part keeps its size
 * whatever it holds, and the slots go by their place, not their title, so a slider move, which
 * re-sorts them, changes what each slot holds and moves nothing on the page (Chrome counts a
 * title's slot moved to first place as a layout shift, and a sticker grown from R to SSR too, so
 * a new rarity is a new sticker); a slot with no title keeps its place, empty. `words` are the set
 * sliders' words, such as "Very cozy · Dark", their room kept while none is set. `rowRef` goes to
 * the row, for the pool's hold (see useHeldPool).
 */
export function Matches({
  heading,
  words,
  titles,
  why,
  rowRef,
  onOpen,
}: {
  heading: string
  words: string
  titles: readonly Media[]
  why: (media: Media) => string[]
  rowRef: Ref<HTMLOListElement>
  onOpen: OpenTitle
}) {
  return (
    <div className="ab-matches">
      <h3>{heading}</h3>
      <p className={words ? 'ab-set' : 'ab-set is-off'}>{words || '·'}</p>
      <ol ref={rowRef} className="ab-match-row">
        {Array.from({ length: MATCHES }, (_, i) => {
          const media = titles[i]
          if (!media)
            return (
              <li key={i} className="ab-match is-empty" aria-hidden="true">
                <span className="ab-match-cover" />
                <span className="ab-match-title" />
                <span className="ab-match-why" />
              </li>
            )
          const rarity = rarityOf(media.averageScore)
          const names = why(media)
          return (
            <li key={i}>
              <a
                className="ab-match"
                href={titlePath(media.id)}
                onClick={opener(media, onOpen)}
                style={accentVars(media.coverImage.color)}
              >
                <span className="ab-match-cover">
                  <img
                    key={media.id}
                    src={media.coverImage.large}
                    alt=""
                    onLoad={markLoaded}
                    onError={markBroken}
                  />
                  <span key={rarity.key} className="ab-tier" aria-hidden="true">
                    {rarity.key === 'mystery' ? '?' : rarity.label}
                  </span>
                </span>
                <span className="ab-match-title">{titleOf(media)}</span>
                <span className="sr-only">, {rarity.label}.</span>
                <span className="ab-match-why">
                  {names.length ? `Why: ${names.join(' · ')}` : ''}
                </span>
              </a>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
