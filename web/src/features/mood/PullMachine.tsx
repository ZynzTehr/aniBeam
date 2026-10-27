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
import { flushSync } from 'react-dom'
import { markBroken, markLoaded } from '../../components/cover.ts'
import { cssVars } from '../../components/cssVars.ts'
import { ListControls } from '../../components/ListControls.tsx'
import { opener } from '../../components/opener.ts'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import type { AniListError } from '../../lib/anilist.ts'
import { reducedMotion, watchMotionOff } from '../../lib/motion.ts'
import { formatOf, seasonOf, studioOf, titleOf } from '../anime/format.ts'
import {
  FIRST_ERA,
  poolPage3Query,
  poolQuery,
  wantPool,
  type Era,
  type Media,
} from '../anime/queries.ts'
import { useListIds } from '../list/store.ts'
import { accentVars } from '../theming/deriveAccent.ts'
import { useHeldPool } from './heldPool.ts'
import { moodScoring } from './loadScoring.ts'
import { Matches } from './Matches.tsx'
import { MoodSlider } from './MoodSlider.tsx'
import {
  AXES,
  fewLine,
  LISTED,
  popularHeading,
  REPEATS,
  RULE,
  samplesLine,
  wordOf,
  type Axis,
  type Stop,
} from './moods.ts'
import { DROP_MS, FLIP_MS, OPEN_MS, ROLL_MS } from './flip.ts'
import { rarityOf } from './rarity.ts'
import { pullable, remember, rollNext, type Roll } from './roll.ts'
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
  listed: <>{LISTED}</>,
  // The user's words (D4): no decade named, so the box never changes height with its name.
  ready: (
    <>
      Set a mood, or leave them all at No preference, then roll. Every capsule holds a real anime
      from the decade below.
    </>
  ),
}
type Hint = keyof typeof HINTS

// The line while the pool is on its way, which a screen reader is not told (see the status line).
const FILLING = 'Filling the machine…'

/**
 * The line for what the next roll would find, `next`: a repeat, as every title that can come up
 * has, lately, so the oldest of them comes back (see rollNext); or, once the machine holds the
 * `whole` decade, fewer than 20 left to come up; else none. None while page 3 is on its way
 * (`filling`), whose titles would come up then.
 */
const ending = (next: Roll<Media>, whole: boolean, filling: boolean) =>
  filling
    ? ''
    : next.reason === 'repeat'
      ? REPEATS
      : next.reason === 'few' && whole
        ? fewLine(next.left)
        : ''

// Whether AniList's 429 holds a request back: it is tried again once the minute is up.
const busy = (query: { isFetching: boolean; failureReason: Error | null }) =>
  query.isFetching && (query.failureReason as AniListError | null)?.status === 429

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

// The flip's timings, for the motion block's rules to read (see flip.ts).
const TIMES = cssVars({
  '--drop': `${DROP_MS}ms`,
  '--open': `${OPEN_MS}ms`,
  '--flip': `${FLIP_MS}ms`,
})

/**
 * The gacha machine, drawn in ink: set the mood sliders, pull the lever, and a capsule drops and a
 * card turns over on a random title of the decade open below it (`era`), so a pull costs no API
 * request (none of it moves under reduced motion, where the card shows at once): from its
 * mood pool, about 100 titles, once that is in the cache, and until then from the decade's titles
 * on the page (`titles`). With a slider set, a pull gives one of the 12 titles that best match the
 * sliders (rankMatches, from the mood scoring's own file); with none, any title. Never one on My
 * List, nor any of the last 30 rolled while another can come up, and then the oldest of them
 * first, under the line "Every match has come up once. Repeats start now."; nor another season of
 * a show rolled lately while a title of another show can come up (see rollNext). A roll made with
 * fewer than 10 of the pool's titles left to come up asks for its page 3, once, if page 2 said
 * there is one (A12); once the machine holds all it will of the decade, under 20 titles left, the
 * line says how many. Under the rolled title, the top 3 matches, which a slider re-sorts at once
 * (see Matches). The rolled card shows the title's rarity, name, season, format and studio, its
 * Why line and what rarity means (A11), then its My List row, Details, which opens its title card,
 * and Roll again (A10). The sliders, the last rolls and the rolled title are kept for the visit
 * (see session.ts).
 *
 * The pool is asked for only once it is wanted (the plan's section 2, D1): a slider pressed, the
 * decade changed with one set, a pull with fewer than 10 titles left to come up, or a page of
 * titles none of which can come up. So a visitor who only looks, or pulls a few times, costs
 * AniList nothing more. Once wanted, a decade's pool stays wanted for the visit, but it is asked
 * for only while the page's titles are `settled` (AniList's answer for the decade, not still on
 * its way, nor the last decade's standing in, nor the samples, nor held for a title opened at its
 * address) and the browser is online.
 */
export function PullMachine({
  era,
  titles: page,
  settled,
  loading = false,
  standIn = false,
  outage = false,
  onOpen,
}: {
  /** The decade open below, whose pool the machine asks for; null asks for none (the gallery). */
  era: Era | null
  /** The decade's titles on the page: AniList's, the last decade's while it loads, or samples. */
  titles: Media[]
  /** Whether `titles` are AniList's answer for `era` (see above). */
  settled: boolean
  /** Whether AniList is being asked for the decade's titles: a first ask, a refresh or a retry. */
  loading?: boolean
  /** Whether `titles` are the last decade's, standing in while the open decade's load. */
  standIn?: boolean
  /** Whether the decade shows the samples, as AniList can't be reached. */
  outage?: boolean
  onOpen: OpenTitle
}) {
  const { sliders, ring, pulls, pulled, wanted, page3 } = useSession()
  // Whether the rolled card shows its title: not while it turns (see flip.ts). Shown at once when
  // the machine is drawn again with a roll already made (back from My List).
  const [revealed, setRevealed] = useState(true)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const reveal = () => {
    clearTimeout(timer.current)
    setRevealed(true)
  }
  // Motion turned off as the card turns, by the site's switch or on the device, ends the turn at
  // its last frame: the motion block's flip stops with it, and the title shows in that same frame,
  // before it is drawn (see watchMotionOff), never a frame of the cover without its text. It
  // starts watching as the card is put on the page, with motion allowed, before anything else
  // runs: watching from a later moment, it would take motion turned off in between for how
  // things stood, and never hear it.
  const sentinel = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = sentinel.current
    if (!element || revealed) return
    return watchMotionOff(element, () => flushSync(reveal))
    // Each roll draws a card, and its sentinel, of its own.
  }, [revealed, pulls])
  const lever = useRef<HTMLButtonElement>(null)
  // The rolled card's Roll again: each roll draws a card of its own, so a roll from it gives its
  // focus to the new card's, as the card's place and its buttons stay where they were.
  const again = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useLayoutEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    again.current?.focus()
  }, [pulls])
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
  // A refresh of the pool waits while the matches are on screen, and a decade's pool on its way
  // leaves the last one's matches in place meanwhile (see useHeldPool). It is on its way only
  // while the page's titles are in, or on theirs: not while a title opened at its address holds
  // them, nor once their own request has failed (a refresh, its saved titles kept), as the pool
  // waits for them to land; then nothing says "Filling the machine…".
  const coming = want && (settled || loading) && online && !outage && !pool.data && !pool.isError
  // The last decade's pool stays only while its page stands in for the open decade's titles: once
  // they are in, they stand in for their own pool, so a pull never gives a title of another decade.
  const [held, matchesRef] = useHeldPool(
    era?.id ?? null,
    era ? pool.data?.titles : undefined,
    coming && !settled,
  )
  // Page 3 of the decade's pool, once a roll has wanted it (see pull) and only if page 2 said there
  // is one: asked for once, and kept, as the pool is, for whenever the decade is open again. Its
  // titles follow the pool's, but those the pool already has (AniList's order shifts between
  // requests), and wait for the pool: with the page's titles alone, page 3 would be all there is.
  const deeper = !!era && !!pool.data?.hasNextPage
  const wants3 = !!era && deeper && page3.includes(era.id)
  const third = useQuery({
    ...poolPage3Query(era ?? FIRST_ERA),
    enabled: wants3 && online && !outage,
  })
  const titles = useMemo(() => {
    if (!held?.length) return onPage
    const ids = new Set(held.map(({ id }) => id))
    const more = deeper ? (third.data ?? []).filter(({ id }) => !ids.has(id)) : []
    return more.length ? [...held, ...more] : held
  }, [held, onPage, deeper, third.data])
  // Whether the machine holds every title of the decade it will: the pool, and its page 3 if there
  // is one. Only then can it say how few are left in the decade.
  const whole = titles !== onPage && !!pool.data && (!deeper || !!third.data)
  // Whether page 3 is wanted and not in yet, nor failed: till it lands, no line says repeats start
  // or how few are left, as its titles would then come up.
  const filling = wants3 && !third.data && !third.isError
  // The decade the titles come from, which heads the matches: the last one while its titles stand
  // in, so the heading never names a decade they are not from. Set as the component renders.
  const [from, setFrom] = useState(era)
  if (!standIn && from !== era) setFrom(era)
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
  // slider moves; if not, it loads then, and the titles keep the page's order meanwhile. Should it
  // fail (offline, or an old tab after a deploy renamed it), the line says so, with Try again,
  // which loads it again, and the pool, which failed with it, asking AniList nothing. A pool wanted
  // with no slider set fails with it too, unseen, and an errored query isn't asked for again on
  // its own: once the scoring loads here, a pool that failed is asked for again, if still wanted,
  // and so is its page 3, which needs the scoring too.
  const [scoring, setScoring] = useState(moodScoring.current)
  const [failed, setFailed] = useState(false)
  const scored = scoring ?? moodScoring.current
  useEffect(() => {
    if (!set || scored || failed) return
    moodScoring.load().then(
      (loaded) => {
        setScoring(loaded)
        for (const { queryKey } of [poolQuery(era ?? FIRST_ERA), poolPage3Query(era ?? FIRST_ERA)])
          void client.refetchQueries({
            queryKey,
            type: 'active',
            predicate: (query) => query.state.status === 'error',
          })
      },
      () => setFailed(true),
    )
  }, [set, scored, failed, client, era])
  const retry = () => {
    setFailed(false)
    if (pool.isError) void pool.refetch()
  }
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

  // The line for what the next roll would find (see ending).
  const ends = useMemo(
    () => ending(rollNext({ ranked, listed, ring, random: () => 0 }), whole, filling),
    [ranked, listed, ring, whole, filling],
  )

  // A roll, from the lever or from the rolled card's Roll again (`fromCard`), whose focus then goes
  // to the new card's.
  function pull(fromCard = false) {
    // A press while the card turns ends the turn at once and rolls nothing (the user's pick, A9),
    // so a quick second press never skips a title unseen: the next press rolls.
    if (!revealed) return reveal()
    const { media, needMore } = rollNext({
      ranked,
      listed,
      ring,
      windowed: set,
      random: Math.random,
      shown: pulled?.id,
    })
    // Fewer than 10 left to come up: the decade's pool is wanted, and once it is in, its page 3, if
    // page 2 said there is one; never by a slider, as a slider's move changes neither.
    const more = needMore && era && !wanted.includes(era.id) ? [...wanted, era.id] : wanted
    const deep =
      needMore && era && deeper && titles !== onPage && !page3.includes(era.id)
        ? [...page3, era.id]
        : page3
    if (!media) return setSession({ wanted: more, page3: deep })
    clearTimeout(timer.current)
    refocus.current = fromCard
    const next = remember(ring, media.id)
    setSession({ ring: next, pulls: pulls + 1, pulled: media, wanted: more, page3: deep })
    // The line as this roll leaves it, said with the roll and kept with it: a change to My List or
    // the decade after it changes the line, but never what was said of this roll. With page 3 on
    // its way, wanted by this roll or before it, its titles are still to come up.
    const words = ending(
      rollNext({ ranked, listed, ring: next, random: () => 0 }),
      whole,
      filling || (deep !== page3 && !third.data),
    )
    setNews((now) => ({ ...now, of: 'pull', words }))
    // With reduced motion, no flip: the card shows at once.
    const still = reducedMotion()
    setRevealed(still)
    if (!still) timer.current = window.setTimeout(reveal, ROLL_MS)
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
  // The rolled title's Why line, by the sliders as they stand, as the matches' (see Matches).
  const why = pulled && set && scored ? scored.whyOf(pulled, sliders) : []
  const hint: Hint = !page.length
    ? 'empty'
    : !titles.length
      ? 'unpullable'
      : !out.length
        ? 'listed'
        : 'ready'
  // Offline with no titles at all, nothing can be moved or pulled (spec §3I).
  const off = !page.length && !online
  // The line over the matches: what keeps the machine from its best, if anything (the approved
  // words), else the set sliders' words.
  // A set slider with no scoring comes first, as only Try again can mend it.
  const scoringFailed = set && failed
  const line = scoringFailed
    ? 'The mood scoring didn’t load.'
    : off
      ? 'Offline: waiting for a connection.'
      : outage && titles === onPage
        ? samplesLine(out.length)
        : busy(pool) || busy(third)
          ? 'AniList is busy right now. It’s not something you did. Trying again within a minute.'
          : (set && !scored) || coming
            ? FILLING
            : // With a card rolled, the hint that says so is not on the page.
              pulled && titles.length && !out.length
              ? LISTED
              : ends
  // What the status line says, as it happens: each roll as its card shows, and what keeps the
  // machine from its best as that begins (the line, but "Filling the machine…", which comes and
  // goes with a first press, and how the rolls end, repeats or how few are left, which a roll
  // brings and says with its own words), whichever came last. Never the sliders' words: each
  // slider says its own. Set as the component renders.
  const notice = line === FILLING || line === ends ? '' : line
  const [news, setNews] = useState({ notice, of: 'pull', words: '' })
  if (news.notice !== notice) setNews({ ...news, notice, of: notice ? 'notice' : news.of })
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
            <fieldset className="ab-moods" disabled={off}>
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
            <button
              type="button"
              className={set ? 'ab-reset' : 'ab-reset is-off'}
              onClick={reset}
              disabled={off}
            >
              Reset moods
            </button>
            {/* Its name never changes, so a screen reader hears the same button after a roll; the
                words it shows, "Roll!" and then "Roll again!", start as its name does (the
                user's pick, A10). */}
            <button
              ref={lever}
              type="button"
              className="ab-lever"
              aria-label="Roll a random anime"
              onClick={() => pull()}
              disabled={!out.length}
            >
              <span>{pulls ? 'Roll again!' : 'Roll!'}</span>
            </button>
            <p className="ab-count">
              {pulls === 0
                ? 'No rolls yet'
                : `${pulls} ${pulls === 1 ? 'roll' : 'rolls'} this visit`}
            </p>
          </div>
        </div>

        <div className="ab-reveal">
          {pulled && rarity ? (
            <div
              key={pulls}
              className={`ab-result ab-${rarity.key} ${revealed ? 'is-open' : ''}`}
              style={{ ...accentVars(pulled.coverImage.color), ...TIMES }}
            >
              {/* The capsule drops and pops open as the card turns: only then, so none is left
                  over the title, nor shown under reduced motion, which shows the card at once. */}
              {!revealed && (
                <span className="ab-drop" aria-hidden="true">
                  <span className="ab-half ab-top-half" />
                  <span className="ab-half ab-bottom-half" />
                </span>
              )}
              {revealed && <span className="ab-burst" aria-hidden="true" />}
              {/* As MotionSwitch's: the motion gates widen it, so the machine hears motion turn
                  off in the very frame it does (see above). */}
              <span ref={sentinel} className="ab-motion-sentinel" aria-hidden="true" />
              {/* The card is laid out at the press, so that showing its title moves nothing on the
                  page: its back, then its cover as it turns (F1, see flip.ts), and its text,
                  invisible until it shows (see .ab-result) and out of reach, inert. */}
              <div className="ab-flip">
                <div className="ab-flipper">
                  <span className="ab-face ab-back" aria-hidden="true">
                    <b>?</b>
                    <i>AniBeam</i>
                  </span>
                  <a
                    className="ab-result-panel ab-face"
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
                    <span className="sr-only">Open the title card for {titleOf(pulled)}</span>
                  </a>
                </div>
                {/* Beside the faces, whose edges would cut it off; it booms in as the card
                    shows. */}
                {revealed && (
                  <span className="ab-sfx-tier" aria-hidden="true">
                    {rarity.sfx}
                  </span>
                )}
              </div>
              {/* Its text, invisible and out of reach until it shows, and under it the title's
                  My List row, Details and Roll again, in reach from the press (A10): a press on
                  Roll again as the card turns ends the turn, as the lever's does. */}
              <div className="ab-result-side">
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
                  <p className="ab-result-why">{why.length ? `Why: ${why.join(' · ')}` : ''}</p>
                  <p className="ab-rule">{RULE}</p>
                </div>
                <ListControls id={pulled.id} lineId="ab-roll-list-status" />
                <div className="ab-row-actions">
                  <button
                    type="button"
                    className="ab-btn ab-btn-ink"
                    onClick={(event) => onOpen(pulled, event.currentTarget)}
                  >
                    Details
                  </button>
                  <button
                    ref={again}
                    type="button"
                    className="ab-btn"
                    onClick={() => pull(true)}
                    disabled={!out.length}
                  >
                    Roll again
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
            heading={set ? 'Top matches' : popularHeading(from)}
            line={
              line ||
              AXIS_ORDER.filter((axis) => sliders[axis])
                .map((axis) => wordOf(axis, sliders[axis]))
                .join(' · ')
            }
            onRetry={scoringFailed ? retry : undefined}
            titles={ranked}
            why={(media) => (set && scored ? scored.whyOf(media, sliders) : [])}
            rowRef={matchesRef}
            onOpen={onOpen}
          />
        </div>
      </div>
      {/* Screen readers hear each pull from this one line as its card shows, and what keeps
          the machine from its best (see news). It is always on the page because a live region is
          read only when its text changes. The number keeps a repeated title (a machine with one
          title left) from reading as no change. */}
      <p role="status" className="sr-only">
        {news.of === 'notice'
          ? notice
          : pulled && rarity && revealed
            ? `Roll ${pulls}: ${titleOf(pulled)}, ${rarity.label}.${news.words ? ` ${news.words}` : ''}`
            : ''}
      </p>
    </section>
  )
}
