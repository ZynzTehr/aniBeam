import { useRef } from 'react'
import { markBroken, markLoaded } from '../../components/cover.ts'
import { cssVars } from '../../components/cssVars.ts'
import { ListControls } from '../../components/ListControls.tsx'
import { opener } from '../../components/opener.ts'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { formatOf, seasonOf, studioOf, titleOf } from '../../features/anime/format.ts'
import { pressStatus, useEntry } from '../../features/list/store.ts'
import { accentVars } from '../../features/theming/deriveAccent.ts'
import { titlePath } from '../../lib/route.ts'
import { anySet, whyOf, type Sliders } from './score.ts'
import type { Options } from './switches.ts'
import type { LabTitle } from './titles.ts'
import { RULES } from './wording.ts'
import { rarityOf, whyText } from './words.ts'

/** Where a roll is: none yet, its flip playing, or its card shown. */
export type Phase = 'idle' | 'turning' | 'shown'

/**
 * The rolled card (A9 to A11), in the pull result's own classes: a poster that turns from its back
 * (AniBeam's screentone and a big ? stamp) to the title's cover, then the title's rarity, name,
 * season, format and studio, its Why line and the rarity rule, the real My List row (or A10 b's
 * one Save button), Details and Roll again. The card stays in place from roll to roll, so a
 * focused Roll again keeps its focus; only the poster is drawn again, so its flip plays from the
 * start. The text is laid out at the press and shown as the poster turns, so nothing moves.
 *
 * The flip (A9): F1, the capsule drops and pops, then the card turns; F2, the turn alone; F3,
 * today's capsule, then the cover. The timing is a CSS variable the motion block reads; under
 * reduced motion none of it plays, and the poster and the text fade in over 150 ms instead.
 */
export function RolledCard({
  options,
  media,
  roll,
  phase,
  veiled,
  sliders,
  placeholder,
  onRoll,
  onOpen,
}: {
  options: Options
  media: LabTitle | null
  /** The roll's number: each draws the poster again. */
  roll: number
  phase: Phase
  /** Whether the text waits unseen for the flip (not under reduced motion). */
  veiled: boolean
  sliders: Sliders
  /** A title to lay the card out with before the first roll, unseen. */
  placeholder: LabTitle
  onRoll: () => void
  onOpen: OpenTitle
}) {
  const shown = media ?? placeholder
  const rarity = rarityOf(shown.averageScore)
  const names = anySet(sliders) ? whyOf(shown, sliders) : []
  const details = useRef<HTMLButtonElement>(null)
  const idle = phase === 'idle' || !media
  const hidden = idle || (phase === 'turning' && veiled)
  const meta = [seasonOf(shown), formatOf(shown), studioOf(shown)].filter(Boolean).join(' · ')
  const showRarity = options.a11 === 'show'
  const edge = options.a9edge === 'on'
  return (
    <div
      className={`ab-result ab-${rarity.key} is-open ab-lab-card ab-lab-${options.a9style} ${idle ? 'is-idle' : `is-${phase}`}${edge ? ' ab-lab-edge' : ''}`}
      style={{
        ...accentVars(shown.coverImage.color),
        ...cssVars({ '--ab-lab-t': `${options.a9time}ms` }),
      }}
    >
      {phase === 'turning' && options.a9style !== 'f2' && (
        <span key={`drop-${roll}`} className="ab-drop" aria-hidden="true">
          <span className="ab-half ab-top-half" />
          <span className="ab-half ab-bottom-half" />
        </span>
      )}
      <div className="ab-lab-flip" key={`flip-${roll}`}>
        <div className="ab-lab-flipper">
          <span className={`ab-lab-face ab-lab-back ab-lab-glow-${rarity.key}`} aria-hidden="true">
            <span className="ab-lab-back-mark">?</span>
            <span className="ab-lab-back-name">AniBeam</span>
          </span>
          {idle ? (
            <span className="ab-result-panel ab-lab-face ab-lab-front" aria-hidden="true" />
          ) : (
            <a
              className="ab-result-panel ab-lab-face ab-lab-front"
              href={titlePath(shown.id)}
              onClick={opener(shown, onOpen)}
              inert={phase !== 'shown'}
            >
              <img
                src={shown.coverImage.extraLarge}
                alt=""
                onLoad={markLoaded}
                onError={markBroken}
              />
              <span className="sr-only">Open the title card for {titleOf(shown)}</span>
            </a>
          )}
        </div>
        {/* Beside the faces, not on one, whose edge would cut it off; it booms in as the card
            shows. */}
        {showRarity && phase === 'shown' && media && (
          <span className="ab-sfx-tier" aria-hidden="true">
            {rarity.sfx}
          </span>
        )}
      </div>
      <div className="ab-result-copy">
        <div
          key={`copy-${roll}`}
          className={hidden ? 'ab-lab-copy ab-lab-hidden' : 'ab-lab-copy'}
          inert={hidden}
        >
          <p className={showRarity ? 'ab-tier' : 'ab-tier ab-lab-hidden'}>
            {rarity.label} <span aria-hidden="true">{rarity.stars}</span>
          </p>
          <h3 className="ab-lab-card-title">{titleOf(shown)}</h3>
          <p className="ab-result-meta ab-lab-card-meta">{meta}</p>
          <p className="ab-lab-card-why">
            {options.a8 === 'stickers'
              ? names.map((name) => (
                  <span key={name} className="ab-lab-why-tag">
                    {name}
                  </span>
                ))
              : whyText(names, options.a8)}
          </p>
          {showRarity && <p className="ab-lab-rule">{RULES[options.a11rule]}</p>}
        </div>
        {/* Before the first roll the actions keep their room, unseen and out of reach. */}
        <div className={idle ? 'ab-lab-actions ab-lab-hidden' : 'ab-lab-actions'} inert={idle}>
          {options.a10card === 'full' ? (
            <ListControls id={shown.id} />
          ) : (
            <CompactSave id={shown.id} />
          )}
          <div className="ab-row-actions">
            <button
              ref={details}
              type="button"
              className="ab-btn ab-btn-ink"
              onClick={() => details.current && onOpen(shown, details.current)}
            >
              Details
            </button>
            <button type="button" className="ab-btn" onClick={onRoll}>
              Roll again
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A10 (b): one Save button, pressed while the title is saved (the site's store, the lab's key). */
function CompactSave({ id }: { id: number }) {
  const saved = useEntry(id)?.status === 'SAVED'
  return (
    <div className="ab-lab-compact">
      <button
        type="button"
        className={saved ? 'ab-btn ab-btn-hot' : 'ab-btn'}
        aria-pressed={saved}
        onClick={() => pressStatus(id, 'SAVED')}
      >
        Save
      </button>
    </div>
  )
}
