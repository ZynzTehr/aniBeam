import type { ReactNode } from 'react'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { Machine } from './Machine.tsx'
import { RolledCard } from './RolledCard.tsx'
import type { Options } from './switches.ts'
import { TITLES } from './titles.ts'
import type { useMood } from './useMood.ts'
import { countLine, LEVER } from './wording.ts'

/**
 * A machine and what it rolls, side by side from 820px and stacked on a phone, in the pull's own
 * row: the machine's body with its sliders, the lever and its count; then the page's line over the
 * rolled card, and whatever `under` brings below the card (A1 b's top 3).
 */
export function MachineRow({
  options,
  mood,
  onOpen,
  under,
}: {
  options: Options
  mood: ReturnType<typeof useMood>
  onOpen: OpenTitle
  under?: ReactNode
}) {
  const { gacha } = mood
  const lever = LEVER[options.a10lever]
  return (
    <div className="ab-pull-row">
      <Machine
        options={options}
        sliders={mood.sliders}
        onSliders={mood.setSliders}
        capsules={options.a7dome === 'on' ? mood.rankedTitles : mood.pool}
        off={mood.off}
      >
        <button
          type="button"
          className="ab-lever"
          aria-label={lever.name}
          onClick={gacha.press}
          disabled={gacha.empty || mood.off}
        >
          <span>{gacha.roll ? lever.again : lever.first}</span>
        </button>
        <p className="ab-count">{countLine(gacha.roll, options.a10lever === 'pull')}</p>
      </Machine>
      <div className="ab-reveal">
        {/* The page's line, over the card, with its room kept (see .ab-lab-line). */}
        <p className="ab-lab-line">{mood.line}</p>
        {/* With no titles at all (offline), the card keeps its place, its back showing. */}
        <RolledCard
          options={options}
          media={gacha.media}
          roll={gacha.roll}
          phase={gacha.phase}
          veiled={gacha.veiled}
          sliders={mood.moods}
          placeholder={gacha.media ?? mood.rankedTitles[0] ?? TITLES[0]}
          onRoll={gacha.press}
          onOpen={onOpen}
        />
        {under}
      </div>
    </div>
  )
}
