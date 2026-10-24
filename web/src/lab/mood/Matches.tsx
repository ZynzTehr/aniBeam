import { useLayoutEffect, useRef } from 'react'
import { markBroken, markLoaded } from '../../components/cover.ts'
import { opener } from '../../components/opener.ts'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { titleOf } from '../../features/anime/format.ts'
import { accentVars } from '../../features/theming/deriveAccent.ts'
import { reducedMotion } from '../../lib/motion.ts'
import { titlePath } from '../../lib/route.ts'
import { anySet, whyOf, type Sliders } from './score.ts'
import type { Options } from './switches.ts'
import type { LabTitle } from './titles.ts'
import { rarityOf, setWords, whyText } from './words.ts'

/**
 * Top matches (A7, A8): the best `count` matches, each in a fixed slot keyed by its title, with its
 * cover, rarity sticker, title and one-line Why. Each is a real link to the title's address that
 * opens its card. With A7's slide, a reorder glides over 200 ms, unless motion is reduced.
 */
export function Matches({
  options,
  sliders,
  titles,
  slots = titles.length,
  heading,
  onOpen,
}: {
  options: Options
  sliders: Sliders
  titles: LabTitle[]
  /** How many slots to draw: those without a title hold their place, empty. */
  slots?: number
  /** What the heading says when no slider is set, such as "Most popular in the 1990s". */
  heading: string
  onOpen: OpenTitle
}) {
  const set = anySet(sliders)
  const list = useRef<HTMLOListElement>(null)
  // Where each slot was before this draw, to slide it from there (A7's slide).
  const before = useRef(new Map<string, DOMRect>())
  const order = titles.map(({ id }) => id).join(' ')
  useLayoutEffect(() => {
    const drawn = [...(list.current?.querySelectorAll<HTMLElement>('[data-id]') ?? [])]
    const was = before.current
    const slide = options.a7move === 'slide' && !reducedMotion()
    before.current = new Map(drawn.map((slot) => [slot.dataset.id!, slot.getBoundingClientRect()]))
    if (!slide) return
    for (const slot of drawn) {
      const from = was.get(slot.dataset.id!)
      const to = before.current.get(slot.dataset.id!)
      if (!from || !to || (from.left === to.left && from.top === to.top)) continue
      const dx = from.left - to.left
      const dy = from.top - to.top
      slot.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 200,
        easing: 'ease-out',
      })
    }
  }, [order, options.a7move])
  return (
    <section className="ab-lab-matches" aria-labelledby="ab-lab-matches">
      <h2 id="ab-lab-matches" className="ab-lab-matches-head">
        {set ? 'Top matches' : heading}
      </h2>
      {/* The set words' room is kept while none is set, so the slots stay where they are. */}
      <p className={set ? 'ab-lab-set' : 'ab-lab-set is-hidden'}>{setWords(sliders) || '·'}</p>
      <ol ref={list} className="ab-lab-grid">
        {titles.map((media) => {
          const rarity = rarityOf(media.averageScore)
          const names = set ? whyOf(media, sliders) : []
          return (
            <li key={media.id} className="ab-lab-slot" data-id={media.id}>
              <a
                className="ab-lab-match"
                href={titlePath(media.id)}
                onClick={opener(media, onOpen)}
                style={accentVars(media.coverImage.color)}
              >
                <span className="ab-lab-cover">
                  <img
                    src={media.coverImage.large}
                    alt=""
                    loading="lazy"
                    onLoad={markLoaded}
                    onError={markBroken}
                  />
                  {options.a11 === 'show' && (
                    <span className={`ab-lab-sticker ab-lab-${rarity.key}`}>
                      {rarity.label === 'Mystery' ? '?' : rarity.label}
                      <span className="sr-only">, {rarity.label}</span>
                    </span>
                  )}
                </span>
                <span className="ab-lab-match-title">{titleOf(media)}</span>
                {options.a8 === 'stickers' ? (
                  <span className="ab-lab-match-why ab-lab-why-tags">
                    {names.map((name) => (
                      <span key={name} className="ab-lab-why-tag">
                        {name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="ab-lab-match-why">{whyText(names, options.a8)}</span>
                )}
              </a>
            </li>
          )
        })}
        {Array.from({ length: Math.max(0, slots - titles.length) }, (_, i) => (
          <li key={`empty-${i}`} className="ab-lab-slot is-empty" aria-hidden="true">
            <span className="ab-lab-match">
              <span className="ab-lab-cover" />
              <span className="ab-lab-match-title" />
              <span className="ab-lab-match-why" />
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
