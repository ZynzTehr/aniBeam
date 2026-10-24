import { useMemo, useState } from 'react'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import { TitleCard, type OpenTitle } from '../../components/TitleCard.tsx'
import type { Media } from '../../features/anime/queries.ts'
import { useListIds } from '../../features/list/store.ts'
import { Debug } from './Debug.tsx'
import { LINKS } from './links.ts'
import { Machine } from './Machine.tsx'
import { Matches } from './Matches.tsx'
import { NO_PREFERENCE, rankMatches, type Sliders } from './score.ts'
import { SiteFrame } from './SiteFrame.tsx'
import type { Shown } from './Stage.tsx'
import { eraWords, titlesIn, type EraId } from './titles.ts'

/**
 * Section 1: the Mood page at /mood (A1 a), drawn from the site's own parts: the header, the
 * heading, the pull machine's classes with the site's MoodSliders in its red body, and Top matches
 * with their Why lines, each opening the real title card. The sliders live in memory for the visit
 * (B3 a): no address change, and no request, as they move.
 */
export function MoodStage({ shown }: { shown: Shown }) {
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
  const listed = new Set(useListIds())
  const count = options.a7count === 'none' ? 0 : Number(options.a7count)
  const shownMatches = ranked
    .map(({ media }) => media)
    .filter((media) => options.a7listed === 'stay' || !listed.has(media.id))
    .slice(0, count)
  const capsules = options.a7dome === 'on' ? ranked.map(({ media }) => media) : pool

  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })

  return (
    <SiteFrame links={LINKS}>
      <main id="main" className="ab-lab-mood">
        <section className="ab-pull ab-lab-moodpage" aria-labelledby="mood">
          <SfxHeading as="h1" id="mood" sfx="ムード!">
            Mood Matcher
          </SfxHeading>
          <div className="ab-pull-row">
            <Machine
              options={options}
              sliders={sliders}
              onSliders={setSliders}
              capsules={capsules}
            />
            <div className="ab-reveal" />
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
        </section>
        {(lab.scores === 'on' || lab.spoilers === 'on') && (
          <Debug
            ranked={ranked}
            scale={options.a6}
            scores={lab.scores === 'on'}
            spoilers={lab.spoilers === 'on'}
          />
        )}
      </main>
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
