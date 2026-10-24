import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSamples, samplesFor } from '../../features/anime/fallback.ts'
import { ERAS, type Media } from '../../features/anime/queries.ts'
import {
  getSnapshot,
  listedIn,
  removeAll,
  setStatus,
  useListIds,
} from '../../features/list/store.ts'
import { anySet, NO_PREFERENCE, rankMatches, type Sliders } from './score.ts'
import type { Heard } from './Stage.tsx'
import type { Lab, Options } from './switches.ts'
import { DISCOVER, type EraId, type LabTitle } from './titles.ts'
import { useGacha } from './useGacha.ts'
import { LINES } from './wording.ts'

/**
 * The bundled samples from `era` as the lab's titles (the lab can't tell their seasons apart).
 * They load from their own file, as on the site, once the lab first shows the outage.
 */
const samplesIn = (all: Media[], era: EraId): LabTitle[] => {
  const found = ERAS.find(({ id }) => id === era)
  return (era === 'any' ? all : found ? samplesFor(all, found) : []).map((media) => ({
    ...media,
    sequel: false,
    franchise: '',
  }))
}

/**
 * The titles a machine works from in the lab's state (none of it a decision): the era's titles, or
 * while loading the 37 cached trending and decade titles standing in, or with AniList out of reach
 * the bundled samples, or offline with nothing saved none at all. Few, Repeat and Empty narrow the
 * era: to 15 titles, to 5 already rolled, or to every title listed, kept in memory only.
 */
function poolFor(state: Lab['state'], base: LabTitle[], era: EraId, samples: Media[]) {
  if (state === 'offline') return []
  if (state === 'loading') return DISCOVER
  if (state === 'outage') return samplesIn(samples, era)
  if (state === 'few') return base.slice(0, 15)
  if (state === 'repeat') return base.slice(0, 5)
  return base
}

/**
 * One machine's moods, matches and rolls: its sliders (in memory for the visit, B3 a), its titles
 * ranked by them, and its gacha, with the line the page shows above its card.
 */
export function useMood({
  options,
  lab,
  base,
  era,
  onPage3,
}: {
  options: Options
  lab: Lab
  base: LabTitle[]
  era: EraId
  onPage3: () => void
}) {
  const [sliders, setSliders] = useState<Sliders>(NO_PREFERENCE)
  // Two sliders (A4 b) leave Complexity at No preference.
  const moods = useMemo(
    () => (options.a4 === 'two' ? { ...sliders, complexity: 0 as const } : sliders),
    [sliders, options.a4],
  )
  const [samples, setSamples] = useState<Media[]>([])
  useEffect(() => {
    if (lab.state === 'outage') void loadSamples().then(setSamples, () => {})
  }, [lab.state])
  const pool = useMemo(
    () => poolFor(lab.state, base, era, samples),
    [lab.state, base, era, samples],
  )
  const ranked = useMemo(() => rankMatches(pool, moods, options.a6), [pool, moods, options.a6])
  const rankedTitles = useMemo(() => ranked.map(({ media }) => media), [ranked])
  const distances = useMemo(
    () => new Map(ranked.map(({ media, distance }) => [media.id, distance])),
    [ranked],
  )
  const ids = useListIds()
  const listed = useMemo(
    () => new Set([...ids, ...(lab.state === 'empty' ? pool.map(({ id }) => id) : [])]),
    [ids, lab.state, pool],
  )
  const seed = useMemo(
    () => (lab.state === 'repeat' ? pool.map(({ id }) => id) : []),
    [lab.state, pool],
  )
  const gacha = useGacha({
    options,
    ranked: rankedTitles,
    distances,
    listed,
    sliderSet: anySet(moods),
    era,
    seed,
    onPage3,
  })
  const line =
    lab.state === 'offline'
      ? LINES.offline
      : lab.state === 'loading'
        ? LINES.loading
        : lab.state === 'outage'
          ? LINES.outage(pool.length)
          : lab.state === 'limited'
            ? LINES.limited
            : gacha.line === 'empty'
              ? LINES.empty
              : gacha.line === 'repeat'
                ? LINES.repeat
                : gacha.line === 'few'
                  ? LINES.few(gacha.left)
                  : ''
  return {
    sliders,
    setSliders,
    moods,
    pool,
    ranked,
    rankedTitles,
    listed,
    gacha,
    line,
    /** Offline with nothing saved: the sliders and the lever are off. */
    off: lab.state === 'offline',
  }
}

/**
 * The panel's buttons (see Panel), on this machine: the lab's list (Reset, the top 20 listed, all
 * but 3, all), and Roll 20. Each command acts once.
 */
export function useCommands(heard: Heard | null, mood: ReturnType<typeof useMood>) {
  const done = useRef(0)
  useEffect(() => {
    if (!heard || heard.n === done.current) return
    done.current = heard.n
    const unlisted = mood.rankedTitles.map(({ id }) => id).filter((id) => !mood.listed.has(id))
    if (heard.what === 'reset') removeAll(listedIn(getSnapshot()))
    if (heard.what === 'twenty') unlisted.slice(0, 20).forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'leave3') unlisted.slice(3).forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'drain') unlisted.forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'roll20') mood.gacha.rollMany(20)
  }, [heard, mood])
}
