import { useEffect, useMemo, useRef, useState } from 'react'
import { cssVars } from '../../components/cssVars.ts'
import { opener } from '../../components/opener.ts'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { formatOf, seasonOf, studioOf, titleOf } from '../anime/format.ts'
import type { Media } from '../anime/queries.ts'
import { accentVars } from '../theming/deriveAccent.ts'
import { MOODS, type Mood } from './moods.ts'
import { pickTitle, pullable } from './pick.ts'

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function rarityOf(score: number | null) {
  if (score === null) return { key: 'mystery', label: 'Mystery', stars: '?', sfx: '!?' }
  if (score >= 85) return { key: 'ssr', label: 'SSR', stars: '★★★', sfx: 'SSR!!' }
  if (score >= 75) return { key: 'sr', label: 'SR', stars: '★★', sfx: 'SR!' }
  return { key: 'r', label: 'R', stars: '★', sfx: 'R' }
}

/**
 * The gacha machine, drawn in ink: pick a vibe, pull the lever, and a capsule drops with a
 * random title from `pool` (titles already loaded, so a pull costs no API request). See
 * pullable and pickTitle for which titles can come up.
 */
export function PullMachine({ pool, onOpen }: { pool: Media[]; onOpen: OpenTitle }) {
  const [mood, setMood] = useState<Mood>('any')
  const [pulled, setPulled] = useState<Media | null>(null)
  const [pulls, setPulls] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const seen = useRef(new Set<number>())
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // What can come out: the dome shows these, and with none the lever is off.
  const titles = useMemo(() => pullable(pool), [pool])

  function pull() {
    const choice = pickTitle(titles, MOODS[mood].genres, seen.current, Math.random)
    if (!choice) return
    seen.current.add(choice.id)
    clearTimeout(timer.current)
    setPulled(choice)
    setPulls((n) => n + 1)
    setRevealed(false)
    timer.current = window.setTimeout(() => setRevealed(true), prefersReducedMotion() ? 0 : 900)
  }

  const rarity = pulled ? rarityOf(pulled.averageScore) : null
  return (
    <section id="pull" className="ab-pull" aria-labelledby="ab-pull-title">
      <h2 id="ab-pull-title" className="ab-sfx ab-sfx-small">
        Pull a title
        <span aria-hidden="true">ガチャ!</span>
      </h2>
      <div className="ab-pull-row">
        <div className="ab-machine">
          <div className="ab-dome" aria-hidden="true">
            {titles.slice(0, 9).map((media, i) => (
              <span
                key={media.id}
                className="ab-capsule"
                style={{ ...accentVars(media.coverImage.color), ...cssVars({ '--i': i }) }}
              />
            ))}
          </div>
          <div className="ab-body">
            <fieldset className="ab-moods">
              <legend>Pick a vibe</legend>
              {(Object.keys(MOODS) as Mood[]).map((key) => (
                <label key={key} className="ab-chip">
                  <input
                    type="radio"
                    name="ab-mood"
                    value={key}
                    checked={mood === key}
                    onChange={() => setMood(key)}
                  />
                  <span>{MOODS[key].label}</span>
                </label>
              ))}
            </fieldset>
            <button type="button" className="ab-lever" onClick={pull} disabled={!titles.length}>
              <span>{pulls ? 'Again!' : 'Pull!'}</span>
            </button>
            <p className="ab-count">
              {pulls === 0
                ? 'No pulls yet'
                : `${pulls} ${pulls === 1 ? 'pull' : 'pulls'} this visit`}
            </p>
          </div>
        </div>

        <div className="ab-reveal" aria-live="polite">
          {pulled && rarity ? (
            <div
              key={pulls}
              className={`ab-result ab-${rarity.key} ${revealed ? 'is-open' : ''}`}
              style={accentVars(pulled.coverImage.color)}
            >
              <span className="ab-drop" aria-hidden="true">
                <span className="ab-half ab-top-half" />
                <span className="ab-half ab-bottom-half" />
              </span>
              {revealed && (
                <>
                  <span className="ab-burst" aria-hidden="true" />
                  <a
                    className="ab-result-panel"
                    href={`#title-${pulled.id}`}
                    onClick={opener(pulled, onOpen)}
                  >
                    <img src={pulled.coverImage.extraLarge} alt="" />
                    <span className="ab-sfx-tier" aria-hidden="true">
                      {rarity.sfx}
                    </span>
                    <span className="sr-only">Open the title card for {titleOf(pulled)}</span>
                  </a>
                  <div className="ab-result-copy">
                    <p className="ab-tier">
                      {rarity.label} {rarity.stars}
                    </p>
                    <h3>{titleOf(pulled)}</h3>
                    <p className="ab-result-meta">
                      {[seasonOf(pulled), formatOf(pulled), studioOf(pulled)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="ab-row-actions">
                      <button
                        type="button"
                        className="ab-btn ab-btn-ink"
                        onClick={(event) => onOpen(pulled, event.currentTarget)}
                      >
                        Open title card
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : !pool.length ? (
            <p className="ab-hint">
              The machine fills up with titles once AniList answers. It&rsquo;s not something you
              did.
            </p>
          ) : !titles.length ? (
            <p className="ab-hint">
              None of the titles on this page can come out of the machine. Try another decade below.
            </p>
          ) : (
            <p className="ab-hint">
              Pick a vibe, then pull. Every capsule holds a real anime from what&rsquo;s on this
              page. Coming soon: mood sliders for finer picks.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
