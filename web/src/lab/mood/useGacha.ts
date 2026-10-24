import { useEffect, useRef, useState } from 'react'
import { titleOf } from '../../features/anime/format.ts'
import { reducedMotion } from '../../lib/motion.ts'
import type { Phase } from './RolledCard.tsx'
import { remember, rollNext } from './roll.ts'
import type { Options } from './switches.ts'
import type { LabTitle } from './titles.ts'
import { statusLine } from './wording.ts'
import { rarityOf } from './words.ts'

/** A roll in the lab's log: new or a repeat, and whether the lab takes it for a sequel. */
export type LogRow = { roll: number; id: number; title: string; repeat: boolean; sequel: boolean }

/** What the page's line says of the next roll: nothing left, only repeats, or few left. */
export type RollLine = 'few' | 'repeat' | 'empty' | null

/** What the page draws of the gacha. */
type View = {
  ring: number[]
  media: LabTitle | null
  roll: number
  phase: Phase
  veiled: boolean
  status: string
  log: LogRow[]
}

const START: View = {
  ring: [],
  media: null,
  roll: 0,
  phase: 'idle',
  veiled: false,
  status: '',
  log: [],
}

const NONE: number[] = []

/**
 * The gacha's state for the visit (B3 a: in memory, cleared on reload): the ring of the last 30
 * rolls, the title rolled and where its flip is, the status line, and the lab's log. A press while
 * the flip plays finishes it at once and rolls nothing (A9); nothing is ever queued. Page 3 of an
 * era would be fetched once, when fewer than 10 titles can still come up, counted before the
 * slider window (A12): the lab shows it as a simulated request, `onPage3`.
 */
export function useGacha({
  options,
  ranked,
  distances,
  listed,
  sliderSet,
  era,
  seed = NONE,
  onPage3,
}: {
  options: Options
  ranked: LabTitle[]
  distances: Map<number, number>
  listed: Set<number>
  sliderSet: boolean
  era: string
  /** Titles counted as rolled before the visit's first roll (the lab's Repeat state). */
  seed?: number[]
  onPage3: () => void
}) {
  // What the page draws, and the same kept for the handlers between draws, with what only they
  // need: the titles seen, the eras whose page 3 was fetched, and the flip's timer.
  const [view, setView] = useState<View>(START)
  const state = useRef({ ...START, seen: new Set<number>(), page3: new Set<string>(), timer: 0 })
  const publish = () => {
    const { seen: _seen, page3: _page3, timer: _timer, ...shown } = state.current
    setView(shown)
  }
  useEffect(() => () => clearTimeout(state.current.timer), [])

  const ask = (random: () => number, ring: number[], shown?: number) =>
    rollNext({
      ranked,
      distances,
      listed,
      ring: [...seed.filter((id) => !ring.includes(id)), ...ring],
      sliderSet,
      random,
      shown,
      picking: options.a12pick,
      whenSpent: options.a12spent,
      sequels: options.b2,
    })

  function finish() {
    const now = state.current
    clearTimeout(now.timer)
    if (now.phase !== 'turning' || !now.media) return
    now.phase = 'shown'
    const rarity = options.a11 === 'show' ? rarityOf(now.media.averageScore).label : null
    now.status = statusLine(now.roll, titleOf(now.media), rarity)
    publish()
  }

  /** The lever: a roll, or, while a flip plays, the end of it. */
  function press() {
    if (state.current.phase === 'turning') return finish()
    roll()
  }

  function roll() {
    const now = state.current
    const next = ask(Math.random, now.ring, now.media?.id)
    if (!next.media) return
    const { media } = next
    const repeat = now.seen.has(media.id)
    now.seen.add(media.id)
    now.ring = remember(now.ring, media.id)
    now.roll++
    now.media = media
    now.phase = 'turning'
    now.veiled = !reducedMotion()
    now.log = [
      ...now.log,
      { roll: now.roll, id: media.id, title: titleOf(media), repeat, sequel: media.sequel },
    ]
    if (next.page3 && !now.page3.has(era)) {
      now.page3.add(era)
      onPage3()
    }
    clearTimeout(now.timer)
    now.timer = window.setTimeout(finish, reducedMotion() ? 150 : Number(options.a9time))
    publish()
  }

  /** "Roll 20": twenty rolls in a row, each flip finished as the next starts. */
  function rollMany(times: number) {
    for (let i = 0; i < times; i++) {
      finish()
      roll()
    }
  }

  // What the next roll would find: nothing (the lever is off, and the empty line shows), only
  // recent rolls (the repeat line), or few titles (the few line, with how many).
  const next = ask(() => 0, view.ring, view.media?.id)
  const empty = next.media === null
  const line: RollLine = empty
    ? 'empty'
    : next.reason === 'repeat'
      ? 'repeat'
      : next.reason === 'few'
        ? 'few'
        : null
  return {
    ...view,
    line,
    left: next.left,
    empty,
    distinct: new Set(view.log.slice(-30).map(({ id }) => id)).size,
    press,
    rollMany,
  }
}
