import { useEffect, useMemo, useRef, useState } from 'react'
import { markBroken, markLoaded } from '../../components/cover.ts'
import { cssVars } from '../../components/cssVars.ts'
import { opener } from '../../components/opener.ts'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { reducedMotion } from '../../lib/motion.ts'
import { formatOf, seasonOf, studioOf, titleOf } from '../anime/format.ts'
import type { Media } from '../anime/queries.ts'
import { useListIds } from '../list/store.ts'
import { accentVars } from '../theming/deriveAccent.ts'
import { MOODS, type Mood } from './moods.ts'
import { pullable, pullNext, remember } from './roll.ts'
import { titlePath } from '../../lib/route.ts'

// What the machine says before a pull: with no titles yet, with none it may hand out, with all it
// may on My List, or with some.
const HINTS = {
  empty: (
    <>The machine fills up with titles once AniList answers. It&rsquo;s not something you did.</>
  ),
  unpullable: (
    <>None of the titles on this page can come out of the machine. Try another decade below.</>
  ),
  listed: <>Everything in the machine is on your list. Try another decade below.</>,
  ready: (
    <>
      Pick a vibe, then pull. Every capsule holds a real anime from what&rsquo;s on this page.
      Coming soon: mood sliders for finer picks.
    </>
  ),
}
type Hint = keyof typeof HINTS

function rarityOf(score: number | null) {
  if (score === null) return { key: 'mystery', label: 'Mystery', stars: '?', sfx: '!?' }
  if (score >= 85) return { key: 'ssr', label: 'SSR', stars: '★★★', sfx: 'SSR!!' }
  if (score >= 75) return { key: 'sr', label: 'SR', stars: '★★', sfx: 'SR!' }
  return { key: 'r', label: 'R', stars: '★', sfx: 'R' }
}

// The visit's last pulls, the oldest first, which a pull skips while it can (see rollNext). Kept
// while the visitor moves around the site, which draws the machine again on the way back to
// Discover, and gone on a reload.
let ring: number[] = []

/**
 * The gacha machine, drawn in ink: pick a vibe, pull the lever, and a capsule drops with a
 * random title from `pool` (titles already loaded, so a pull costs no API request). A pull
 * gives a title with one of the vibe's genres, never one on My List, nor any of the last 30
 * pulled while another can come up (see pullable and pullNext).
 */
export function PullMachine({ pool, onOpen }: { pool: Media[]; onOpen: OpenTitle }) {
  const [mood, setMood] = useState<Mood>('any')
  const [pulled, setPulled] = useState<Media | null>(null)
  const [pulls, setPulls] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const listedIds = useListIds()
  const listed = useMemo(() => new Set(listedIds), [listedIds])
  const titles = useMemo(() => pullable(pool), [pool])
  // What can come out, the titles not on My List: the dome shows these, and with none the lever
  // is off.
  const out = useMemo(() => titles.filter((media) => !listed.has(media.id)), [titles, listed])

  function pull() {
    const { genres } = MOODS[mood]
    const choice = pullNext({
      titles,
      genres,
      listed,
      ring,
      random: Math.random,
      shown: pulled?.id,
    })
    if (!choice) return
    ring = remember(ring, choice.id)
    clearTimeout(timer.current)
    setPulled(choice)
    setPulls((n) => n + 1)
    setRevealed(false)
    timer.current = window.setTimeout(() => setRevealed(true), reducedMotion() ? 0 : 900)
  }

  const rarity = pulled ? rarityOf(pulled.averageScore) : null
  const hint: Hint = !pool.length
    ? 'empty'
    : !titles.length
      ? 'unpullable'
      : !out.length
        ? 'listed'
        : 'ready'
  return (
    // The links to #pull land on the heading, which takes their focus, as the other sections' do.
    <section className="ab-pull" aria-labelledby="pull">
      <SfxHeading id="pull" sfx="ガチャ!" small>
        Pull a title
      </SfxHeading>
      <div className="ab-pull-row">
        <div className="ab-machine">
          <div className="ab-dome" aria-hidden="true">
            {out.slice(0, 9).map((media, i) => (
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
            <button type="button" className="ab-lever" onClick={pull} disabled={!out.length}>
              <span>{pulls ? 'Again!' : 'Pull!'}</span>
            </button>
            <p className="ab-count">
              {pulls === 0
                ? 'No pulls yet'
                : `${pulls} ${pulls === 1 ? 'pull' : 'pulls'} this visit`}
            </p>
          </div>
        </div>

        <div className="ab-reveal">
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
              {revealed && <span className="ab-burst" aria-hidden="true" />}
              {/* The title is laid out at the press, so that opening the capsule 900 ms later
                  moves nothing on the page; until then it is invisible (see .ab-result) and out
                  of reach, inert. */}
              <a
                className="ab-result-panel"
                href={titlePath(pulled.id)}
                onClick={opener(pulled, onOpen)}
                inert={!revealed}
              >
                <img
                  src={pulled.coverImage.extraLarge}
                  alt=""
                  onLoad={markLoaded}
                  onError={markBroken}
                />
                <span className="ab-sfx-tier" aria-hidden="true">
                  {rarity.sfx}
                </span>
                <span className="sr-only">Open the title card for {titleOf(pulled)}</span>
              </a>
              <div className="ab-result-copy" inert={!revealed}>
                <p className="ab-tier">
                  {rarity.label} <span aria-hidden="true">{rarity.stars}</span>
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
            </div>
          ) : (
            // The hint that applies, then the others, unseen, in the same place: the box takes the
            // tallest one's size whichever shows, so it doesn't grow as titles arrive and change
            // what it says (on a phone, that pushed the decades down).
            <div className="ab-hints">
              <p key={hint} className="ab-hint">
                {HINTS[hint]}
              </p>
              {(Object.keys(HINTS) as Hint[])
                .filter((other) => other !== hint)
                .map((other) => (
                  <p key={other} className="ab-hint ab-hint-room" aria-hidden="true">
                    {HINTS[other]}
                  </p>
                ))}
            </div>
          )}
        </div>
      </div>
      {/* Screen readers hear each pull from this one line as its capsule opens. It is always on
          the page because a live region is read only when its text changes. The number keeps a
          repeated title (a vibe with one match) from reading as no change. */}
      <p role="status" className="sr-only">
        {pulled && rarity && revealed ? `Pull ${pulls}: ${titleOf(pulled)}, ${rarity.label}.` : ''}
      </p>
    </section>
  )
}
