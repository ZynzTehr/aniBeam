import { useEffect, useRef, useState } from 'react'
import { SfxHeading } from '../../components/SfxHeading.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { LabBoxes } from './LabBoxes.tsx'
import { MachineRow } from './MachineRow.tsx'
import { Matches } from './Matches.tsx'
import type { Heard, Shown } from './Stage.tsx'
import { eraWords, LAB_ERAS, popularHeading, titlesIn, type EraId } from './titles.ts'
import { useCommands, useMood } from './useMood.ts'
import { PAGE } from './wording.ts'

/** Each machine's rolls, for the shell's corner counter. */
export type OnRolls = (rolls: { distinct: number; rolls: number }) => void

/** The era /mood opens on (A13): Discover's last decade, "Any era", or the 2010s. */
const startOf = (a13: Shown['options']['a13'], last: EraId): EraId =>
  a13 === 'any' ? 'any' : a13 === '2010s' ? '2010s' : last

/**
 * The Mood page at /mood (A1 a): its heading, the era chips (A13), the machine with the sliders in
 * its red body and the rolled card beside it (below it on a phone), and Top matches. As the
 * primary section it hears the panel's buttons and reports its rolls.
 */
export function MoodPage({
  shown,
  heard,
  onRolls,
  onOpen,
  onToast,
}: {
  shown: Shown
  heard: Heard | null
  onRolls?: OnRolls
  onOpen: OpenTitle
  onToast: (text: string) => void
}) {
  const { options, lab } = shown
  const start = startOf(options.a13, lab.last)
  const [picked, setPicked] = useState<{ from: EraId; era: EraId } | null>(null)
  // A chip picked holds until A13 or Discover's last decade changes where the page opens.
  const era = picked && picked.from === start ? picked.era : start
  const [base, setBase] = useState(() => ({ era, titles: titlesIn(era) }))
  if (base.era !== era) setBase({ era, titles: titlesIn(era) })
  const mood = useMood({
    options,
    lab,
    base: base.titles,
    era,
    onPage3: () =>
      onToast(
        `Simulated: fewer than 10 titles can come up, so page 3 of ${eraWords(era)} would be fetched now (1 request, once). The lab adds no titles.`,
      ),
  })
  useCommands(heard, mood)
  const { distinct, roll } = mood.gacha
  useEffect(() => onRolls?.({ distinct, rolls: roll }), [distinct, roll, onRolls])

  const section = useRef<HTMLElement>(null)
  const count = options.a7count === 'none' ? 0 : Number(options.a7count)
  const matches = mood.rankedTitles
    .filter((media) => options.a7listed === 'stay' || !mood.listed.has(media.id))
    .slice(0, count)
  const chips = LAB_ERAS.filter(({ id }) => id !== 'any' || options.a13 === 'any')
  return (
    <>
      <section ref={section} className="ab-pull ab-lab-moodpage" aria-labelledby="mood">
        <SfxHeading as="h1" id="mood" sfx={PAGE.sfx}>
          {PAGE.heading}
        </SfxHeading>
        <fieldset className="ab-eras ab-lab-eras">
          <legend className="sr-only">Era</legend>
          {chips.map(({ id, label }) => (
            <label key={id} className="ab-chip">
              <input
                type="radio"
                name="ab-lab-era"
                value={id}
                checked={era === id}
                onChange={() => setPicked({ from: start, era: id })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <MachineRow options={options} mood={mood} onOpen={onOpen} />
        {count > 0 && (
          <Matches
            options={options}
            sliders={mood.moods}
            titles={matches}
            slots={count}
            heading={popularHeading(era)}
            onOpen={onOpen}
          />
        )}
        {/* Screen readers hear each roll from this one line as its card shows. It is always on
            the page, as a live region is read only when its text changes; the roll's number keeps
            a repeat from reading as no change. */}
        <p role="status" className="sr-only" data-lab="status">
          {mood.gacha.status}
        </p>
      </section>
      <LabBoxes
        name="The Mood page"
        section={section}
        options={options}
        lab={lab}
        mood={mood}
        extra={
          <p className="ab-lab-why">
            Recorded titles in {eraWords(era)}: {base.titles.length}. The real pool is about 100.
          </p>
        }
      />
    </>
  )
}
