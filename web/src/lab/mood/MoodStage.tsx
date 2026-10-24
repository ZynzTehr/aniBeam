import { useEffect, useMemo, useRef, useState } from 'react'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import { TitleCard, type OpenTitle } from '../../components/TitleCard.tsx'
import type { Media } from '../../features/anime/queries.ts'
import {
  getSnapshot,
  listedIn,
  removeAll,
  setStatus,
  useListIds,
} from '../../features/list/store.ts'
import { Debug } from './Debug.tsx'
import { LINKS } from './links.ts'
import { Machine } from './Machine.tsx'
import { Matches } from './Matches.tsx'
import { RolledCard } from './RolledCard.tsx'
import { anySet, NO_PREFERENCE, rankMatches, type Sliders } from './score.ts'
import { SiteFrame } from './SiteFrame.tsx'
import type { Heard, Shown } from './Stage.tsx'
import { eraWords, titlesIn, type EraId } from './titles.ts'
import { useGacha } from './useGacha.ts'
import { countLine, LEVER, LINES } from './wording.ts'

/**
 * Section 1: the Mood page at /mood (A1 a), drawn from the site's own parts: the header, the
 * heading, the pull machine's classes with the site's MoodSliders in its red body, the lever and
 * the rolled card, and Top matches with their Why lines, each opening the real title card. The
 * sliders and the rolls live in memory for the visit (B3 a): no address change, and no request,
 * as they move.
 */
export function MoodStage({
  shown,
  heard,
  onRolls,
}: {
  shown: Shown
  heard: Heard
  onRolls: (rolls: { distinct: number; rolls: number }) => void
}) {
  const { options, lab } = shown
  const [sliders, setSliders] = useState<Sliders>(NO_PREFERENCE)
  // Two sliders (A4 b) leave Complexity at No preference.
  const moods = useMemo(
    () => (options.a4 === 'two' ? { ...sliders, complexity: 0 as const } : sliders),
    [sliders, options.a4],
  )
  const era: EraId = '1990s'
  const pool = useMemo(() => titlesIn(era), [era])
  const ranked = useMemo(() => rankMatches(pool, moods, options.a6), [pool, moods, options.a6])
  const ids = useListIds()
  const listed = useMemo(() => new Set(ids), [ids])
  const count = options.a7count === 'none' ? 0 : Number(options.a7count)
  const shownMatches = ranked
    .map(({ media }) => media)
    .filter((media) => options.a7listed === 'stay' || !listed.has(media.id))
    .slice(0, count)
  const capsules = options.a7dome === 'on' ? ranked.map(({ media }) => media) : pool

  const [toast, setToast] = useState('')
  const rankedTitles = useMemo(() => ranked.map(({ media }) => media), [ranked])
  const distances = useMemo(
    () => new Map(ranked.map(({ media, distance }) => [media.id, distance])),
    [ranked],
  )
  const gacha = useGacha({
    options,
    ranked: rankedTitles,
    distances,
    listed,
    sliderSet: anySet(moods),
    era,
    onPage3: () =>
      setToast(
        `Simulated: fewer than 10 titles can come up, so page 3 of ${eraWords(era)} would be fetched now (1 request, once). The lab adds no titles.`,
      ),
  })
  const { distinct, roll } = gacha
  useEffect(() => onRolls({ distinct, rolls: roll }), [distinct, roll, onRolls])

  // The panel's buttons (see Panel): the lab's list, and Roll 20. Each command acts once.
  const done = useRef(0)
  useEffect(() => {
    if (!heard || heard.n === done.current) return
    done.current = heard.n
    const unlisted = rankedTitles.map(({ id }) => id).filter((id) => !listed.has(id))
    if (heard.what === 'reset') removeAll(listedIn(getSnapshot()))
    if (heard.what === 'twenty') unlisted.slice(0, 20).forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'leave3') unlisted.slice(3).forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'drain') unlisted.forEach((id) => setStatus(id, 'SAVED'))
    if (heard.what === 'roll20') gacha.rollMany(20)
  }, [heard, rankedTitles, listed, gacha])

  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })
  const lever = LEVER[options.a10lever]
  const line =
    gacha.line === 'empty'
      ? LINES.empty
      : gacha.line === 'repeat'
        ? LINES.repeat
        : gacha.line === 'few'
          ? LINES.few(gacha.left)
          : ''

  return (
    <SiteFrame links={LINKS}>
      <main id="main" className="ab-lab-mood">
        <section className="ab-pull ab-lab-moodpage" aria-labelledby="mood">
          <SfxHeading as="h1" id="mood" sfx="ムード!">
            Mood Matcher
          </SfxHeading>
          <div className="ab-pull-row">
            <Machine options={options} sliders={sliders} onSliders={setSliders} capsules={capsules}>
              <button
                type="button"
                className="ab-lever"
                aria-label={lever.name}
                onClick={gacha.press}
                disabled={gacha.empty}
              >
                <span>{gacha.roll ? lever.again : lever.first}</span>
              </button>
              <p className="ab-count">{countLine(gacha.roll, options.a10lever === 'pull')}</p>
            </Machine>
            <div className="ab-reveal">
              {/* The page's line, over the card, with its room kept (see .ab-lab-line). */}
              <p className="ab-lab-line">{line}</p>
              <RolledCard
                options={options}
                media={gacha.media}
                roll={gacha.roll}
                phase={gacha.phase}
                veiled={gacha.veiled}
                sliders={moods}
                placeholder={rankedTitles[0] ?? pool[0]}
                onRoll={gacha.press}
                onOpen={open}
              />
            </div>
          </div>
          {count > 0 && (
            <Matches
              options={options}
              sliders={moods}
              titles={shownMatches}
              heading={`Most popular in ${eraWords(era)}`}
              onOpen={open}
            />
          )}
          {/* Screen readers hear each roll from this one line as its card shows. It is always on
              the page, as a live region is read only when its text changes; the roll's number
              keeps a repeat from reading as no change. */}
          <p role="status" className="sr-only" data-lab="status">
            {gacha.status}
          </p>
        </section>
        <section className="ab-lab-box" aria-label="Lab: what a screen reader hears">
          <p className="ab-lab-why">
            <span className="ab-lab-tag">Lab</span> The status line:{' '}
            <q data-lab="heard">{gacha.status || 'nothing yet'}</q>
          </p>
        </section>
        {gacha.log.length > 0 && (
          <section className="ab-lab-box" aria-label="Lab: the last 20 rolls">
            <h2 className="ab-lab-legend">
              <span className="ab-lab-tag">Lab</span> The last 20 rolls
            </h2>
            <ol className="ab-lab-log">
              {gacha.log.slice(-20).map((row) => (
                <li key={row.roll} value={row.roll}>
                  {row.title}{' '}
                  <span className={row.repeat ? 'ab-lab-mark is-repeat' : 'ab-lab-mark'}>
                    {row.repeat ? 'repeat' : 'new'}
                  </span>
                  {row.sequel && <span className="ab-lab-mark is-sequel">sequel</span>}
                </li>
              ))}
            </ol>
            <p className="ab-lab-why">
              Different in the last 30 rolls: {gacha.distinct}. Sequels are the lab’s guess from the
              titles.
            </p>
          </section>
        )}
        {(lab.scores === 'on' || lab.spoilers === 'on') && (
          <Debug
            ranked={ranked}
            scale={options.a6}
            scores={lab.scores === 'on'}
            spoilers={lab.spoilers === 'on'}
          />
        )}
      </main>
      {toast && (
        <p className="ab-lab-notice" role="status">
          {toast}{' '}
          <button type="button" className="ab-lab-see" onClick={() => setToast('')}>
            OK
          </button>
        </p>
      )}
      {card && (
        <TitleCard
          key={card.media.id}
          media={card.media}
          from={card.from}
          onClose={() => setCard(null)}
        />
      )}
    </SiteFrame>
  )
}
