import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react'
import { markBroken, markLoaded } from '../../components/cover.ts'
import { cssVars } from '../../components/cssVars.ts'
import { opener } from '../../components/opener.ts'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { reducedMotion } from '../../lib/motion.ts'
import { formatOf, seasonOf, studioOf, titleOf } from '../anime/format.ts'
import { FIRST_ERA, poolQuery, wantPool, type Era, type Media } from '../anime/queries.ts'
import { useListIds } from '../list/store.ts'
import { accentVars } from '../theming/deriveAccent.ts'
import { useHeldPool } from './heldPool.ts'
import { moodScoring } from './loadScoring.ts'
import { Matches } from './Matches.tsx'
import { MoodSlider } from './MoodSlider.tsx'
import { AXES, wordOf, type Axis, type Stop } from './moods.ts'
import { rarityOf } from './rarity.ts'
import { pullable, remember, rollNext } from './roll.ts'
import type { Sliders } from './score.ts'
import { setSession, useSession } from './session.ts'
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

// The matches' heading while every slider is at no preference (the user's pick, D3).
const popular = (era: Era | null) =>
  !era
    ? 'Most popular'
    : era.id === 'upcoming'
      ? 'Most popular upcoming titles'
      : `Most popular ${era.id === 'pre-1970' ? 'before 1970' : `in the ${era.label}`}`

// The sliders in the order the machine shows them.
const AXIS_ORDER = Object.keys(AXES) as Axis[]
const NONE: Sliders = { energy: 0, tone: 0, complexity: 0 }

// Whether the browser says it is online, drawn again as that changes.
const isOnline = () => navigator.onLine
const watchOnline = (change: () => void) => {
  addEventListener('online', change)
  addEventListener('offline', change)
  return () => {
    removeEventListener('online', change)
    removeEventListener('offline', change)
  }
}

// A tap that moved less than this, in CSS pixels, over less than this long, is a tap, not a drag.
const TAP_PX = 10
const TAP_MS = 500
// MoodSlider.css's thumb, whose middle travels from half its width in to half its width in.
const THUMB = 40

/**
 * The gacha machine, drawn in ink: set the mood sliders, pull the lever, and a capsule drops with
 * a random title of the decade open below it (`era`), so a pull costs no API request: from its
 * mood pool, about 100 titles, once that is in the cache, and until then from the decade's titles
 * on the page (`titles`). With a slider set, a pull gives one of the 12 titles that best match the
 * sliders (rankMatches, from the mood scoring's own file); with none, any title. Never one on My
 * List, nor any of the last 30 pulled while another can come up (see rollNext). Under the pulled
 * title, the top 3 matches, which a slider re-sorts at once (see Matches). The sliders, the last
 * pulls and the pulled title are kept for the visit (see session.ts).
 *
 * The pool is asked for only once it is wanted (the plan's section 2, D1): a slider pressed, the
 * decade changed with one set, a pull with fewer than 10 titles left to come up, or a page of
 * titles none of which can come up. So a visitor who only looks, or pulls a few times, costs
 * AniList nothing more. Once wanted, a decade's pool stays wanted for the visit, but it is asked
 * for only while the page's titles are `settled` (AniList's answer for the decade, not still on
 * its way, nor the last decade's standing in, nor the samples) and the browser is online.
 */
export function PullMachine({
  era,
  titles: page,
  settled,
  outage = false,
  onOpen,
}: {
  /** The decade open below, whose pool the machine asks for; null asks for none (the gallery). */
  era: Era | null
  /** The decade's titles on the page: AniList's, the last decade's while it loads, or samples. */
  titles: Media[]
  /** Whether `titles` are AniList's answer for `era` (see above). */
  settled: boolean
  /** Whether the decade shows the samples, as AniList can't be reached. */
  outage?: boolean
  onOpen: OpenTitle
}) {
  const { sliders, ring, pulls, pulled, wanted } = useSession()
  // Shown at once when the machine is drawn again with a pull already made (back from My List).
  const [revealed, setRevealed] = useState(true)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const lever = useRef<HTMLButtonElement>(null)
  const listedIds = useListIds()
  const listed = useMemo(() => new Set(listedIds), [listedIds])
  const set = AXIS_ORDER.some((axis) => sliders[axis] !== 0)
  const onPage = useMemo(() => pullable(page), [page])
  // A page none of whose titles can come up, all on My List or among the last pulls (or none may
  // come out at all): the decade's pool may have others.
  const spent =
    page.length > 0 && onPage.every((media) => listed.has(media.id) || ring.includes(media.id))
  const want = era !== null && (set || wanted.includes(era.id) || (settled && spent))
  const online = useSyncExternalStore(watchOnline, isOnline)
  // Keyed by the decade alone, so no slider's value asks for anything. Once in the cache, the
  // pool is used whenever its decade is open, wanted or not.
  const pool = useQuery({ ...poolQuery(era ?? FIRST_ERA), enabled: want && settled && online })
  // A refresh of the pool waits while the matches are on screen (see useHeldPool).
  const [held, matchesRef] = useHeldPool(era?.id ?? null, era ? pool.data?.titles : undefined)
  const titles = held?.length ? held : onPage
  // What can come out, the titles not on My List: with none, the lever is off.
  const out = useMemo(() => titles.filter((media) => !listed.has(media.id)), [titles, listed])

  // A wanted pool is said so before the page asks for the decade's titles (App's effects run after
  // its children's), so a decade picked with a slider set asks for its titles and its pool in one
  // request (see wantPool), never during an outage. And it stays wanted for the visit.
  const client = useQueryClient()
  useLayoutEffect(() => {
    if (!era || !want) return
    if (online && !outage) wantPool(client, era)
    if (!wanted.includes(era.id)) setSession({ wanted: [...wanted, era.id] })
  }, [era, want, online, outage, client, wanted])

  // The mood scoring is a file of its own (see loadScoring.ts), most often loaded by the time a
  // slider moves; if not, it loads then, and the titles keep the page's order meanwhile.
  const [scoring, setScoring] = useState(moodScoring.current)
  const scored = scoring ?? moodScoring.current
  useEffect(() => {
    if (set && !scored) moodScoring.load().then(setScoring, () => {})
  }, [set, scored])
  const ranked = useMemo(
    () => (set && scored ? scored.rankMatches(titles, sliders) : titles),
    [set, scored, titles, sliders],
  )
  // The dome shows the colors of the best matches that can come out, each capsule in its place
  // (keyed by it, not its title), so a new order moves none.
  const dome = useMemo(
    () => ranked.filter((media) => !listed.has(media.id)).slice(0, 9),
    [ranked, listed],
  )

  function pull() {
    const { media, needMore } = rollNext({
      ranked,
      listed,
      ring,
      windowed: set,
      random: Math.random,
      shown: pulled?.id,
    })
    // Fewer than 10 left to come up: the decade's pool is wanted.
    const more = needMore && era && !wanted.includes(era.id) ? [...wanted, era.id] : wanted
    if (!media) return setSession({ wanted: more })
    clearTimeout(timer.current)
    setSession({ ring: remember(ring, media.id), pulls: pulls + 1, pulled: media, wanted: more })
    setRevealed(false)
    timer.current = window.setTimeout(() => setRevealed(true), reducedMotion() ? 0 : 900)
  }

  const move = (axis: Axis, stop: Stop) => setSession({ sliders: { ...sliders, [axis]: stop } })

  // A slider pressed, by a pointer or a key that moves it, wants the decade's pool (focus alone
  // never does): a pointer's press asks before the finger lifts.
  const press = () => {
    if (era && !wanted.includes(era.id)) setSession({ wanted: [...wanted, era.id] })
  }

  // A tap on a slider's track, not a drag, sets the stop under the finger (the user's pick, A5):
  // Safari on an iPhone only focuses a slider on a tap, which feels broken. The slider is never
  // focused from code (WebKit bug 266283). A mouse's click jumps there by itself.
  const tap = useRef<{ x: number; y: number; at: number } | null>(null)
  const isRange = (target: EventTarget): target is HTMLInputElement =>
    target instanceof HTMLInputElement && target.type === 'range'
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (isRange(event.target) && !event.target.disabled) press()
    tap.current =
      event.pointerType !== 'mouse' && isRange(event.target)
        ? { x: event.clientX, y: event.clientY, at: event.timeStamp }
        : null
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const start = tap.current
    tap.current = null
    const input = event.target
    if (!start || !isRange(input) || input.disabled) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > TAP_PX || event.timeStamp - start.at > TAP_MS) return
    const box = input.getBoundingClientRect()
    const along = (event.clientX - box.left - THUMB / 2) / Math.max(1, box.width - THUMB)
    const stop = Math.max(-2, Math.min(2, Math.round(along * 4) - 2)) as Stop
    const axis = AXIS_ORDER[[...event.currentTarget.querySelectorAll('input')].indexOf(input)]
    if (axis && stop !== sliders[axis]) move(axis, stop)
  }

  // Reset moods hides once every slider is back at no preference: focus, on it, goes on to the
  // lever, rather than off the page.
  const reset = (event: { currentTarget: HTMLButtonElement }) => {
    if (document.activeElement === event.currentTarget) lever.current?.focus()
    setSession({ sliders: NONE })
  }

  const rarity = pulled ? rarityOf(pulled.averageScore) : null
  const hint: Hint = !page.length
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
            {dome.map((media, i) => (
              <span
                key={i}
                className="ab-capsule"
                style={{ ...accentVars(media.coverImage.color), ...cssVars({ '--i': i }) }}
              />
            ))}
          </div>
          <div className="ab-body">
            <fieldset className="ab-moods">
              <legend className="sr-only">Your mood</legend>
              <div className="ab-sliders" onPointerDown={down} onPointerUp={up}>
                {AXIS_ORDER.map((axis) => (
                  <MoodSlider
                    key={axis}
                    axis={axis}
                    value={sliders[axis]}
                    onChange={(stop) => move(axis, stop)}
                  />
                ))}
              </div>
            </fieldset>
            {/* Its room is kept while it is hidden, so nothing moves as it comes and goes. */}
            <button type="button" className={set ? 'ab-reset' : 'ab-reset is-off'} onClick={reset}>
              Reset moods
            </button>
            <button
              ref={lever}
              type="button"
              className="ab-lever"
              onClick={pull}
              disabled={!out.length}
            >
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
          <Matches
            heading={set ? 'Top matches' : popular(era)}
            words={AXIS_ORDER.filter((axis) => sliders[axis])
              .map((axis) => wordOf(axis, sliders[axis]))
              .join(' · ')}
            titles={ranked}
            why={(media) => (set && scored ? scored.whyOf(media, sliders) : [])}
            rowRef={matchesRef}
            onOpen={onOpen}
          />
        </div>
      </div>
      {/* Screen readers hear each pull from this one line as its capsule opens. It is always on
          the page because a live region is read only when its text changes. The number keeps a
          repeated title (a machine with one title left) from reading as no change. */}
      <p role="status" className="sr-only">
        {pulled && rarity && revealed ? `Pull ${pulls}: ${titleOf(pulled)}, ${rarity.label}.` : ''}
      </p>
    </section>
  )
}
