import { useState } from 'react'
import { TitleCard, type OpenTitle } from '../../components/TitleCard.tsx'
import type { Media } from '../../features/anime/queries.ts'
import { DiscoverSliders } from './DiscoverSliders.tsx'
import { linksFor } from './links.ts'
import { MoodPage, type OnRolls } from './MoodPage.tsx'
import { SiteFrame } from './SiteFrame.tsx'
import type { Heard, Shown } from './Stage.tsx'

/**
 * Section 1, as A1 places the mood matcher: (a) the Mood page at /mood; (b) the sliders on
 * Discover's machine; (c) both, Discover's first. Each is drawn from the site's own parts, and
 * each title opens the real title card.
 */
export function MoodStage({
  shown,
  heard,
  onRolls,
}: {
  shown: Shown
  heard: Heard
  onRolls: OnRolls
}) {
  const { options } = shown
  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })
  const [toast, setToast] = useState('')
  const page = options.a1 !== 'discover'
  const discover = options.a1 !== 'page'
  return (
    <SiteFrame links={linksFor(options.a3, page ? 'mood' : 'discover')}>
      <main id="main" className="ab-lab-mood">
        {discover && (
          <DiscoverSliders
            shown={shown}
            heard={page ? null : heard}
            onRolls={page ? undefined : onRolls}
            onOpen={open}
          />
        )}
        {page && (
          <MoodPage
            shown={shown}
            heard={heard}
            onRolls={onRolls}
            onOpen={open}
            onToast={setToast}
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
