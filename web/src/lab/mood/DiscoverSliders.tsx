import { useEffect, useRef } from 'react'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { LabBoxes } from './LabBoxes.tsx'
import { MachineRow } from './MachineRow.tsx'
import { Matches } from './Matches.tsx'
import type { OnRolls } from './MoodPage.tsx'
import type { Heard, Shown } from './Stage.tsx'
import { DISCOVER, onePerFranchise, popularHeading } from './titles.ts'
import { useCommands, useMood } from './useMood.ts'

/**
 * A1 (b): Discover's pull machine with the three sliders in place of its vibe chips, drawn with
 * MoodSlider.css's own rules for the red body, rolling from what Discover holds on a first visit
 * (the 1990s page and trending), with a top 3 under the result. The lever keeps Discover's "Pull!".
 * As the primary section (A1 b alone) it hears the panel's buttons and reports its rolls.
 */
export function DiscoverSliders({
  shown,
  heard,
  onRolls,
  onOpen,
}: {
  shown: Shown
  heard: Heard | null
  onRolls?: OnRolls
  onOpen: OpenTitle
}) {
  const options = { ...shown.options, a10lever: 'pull' as const }
  const mood = useMood({
    options,
    lab: shown.lab,
    base: DISCOVER,
    era: '1990s',
    onPage3: () => {},
  })
  useCommands(heard, mood)
  const { distinct, roll } = mood.gacha
  useEffect(() => onRolls?.({ distinct, rolls: roll }), [distinct, roll, onRolls])
  const section = useRef<HTMLElement>(null)
  return (
    <>
      <section ref={section} className="ab-pull" aria-labelledby="pull">
        <SfxHeading id="pull" sfx="ガチャ!" small>
          Pull a title
        </SfxHeading>
        <MachineRow
          options={options}
          mood={mood}
          onOpen={onOpen}
          under={
            <Matches
              options={options}
              sliders={mood.moods}
              titles={(shown.lab.franchise === 'one'
                ? onePerFranchise(mood.rankedTitles)
                : mood.rankedTitles
              ).slice(0, 3)}
              slots={3}
              heading={popularHeading('1990s')}
              onOpen={onOpen}
            />
          }
        />
        <p role="status" className="sr-only">
          {mood.gacha.status}
        </p>
      </section>
      <LabBoxes
        name="Discover’s machine (A1 b)"
        section={section}
        options={options}
        lab={shown.lab}
        mood={mood}
      />
    </>
  )
}
