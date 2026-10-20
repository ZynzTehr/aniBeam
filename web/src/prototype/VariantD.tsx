// PROTOTYPE ONLY. Variant D, the chosen direction (2026-10-08). It is drawn with the production
// components (src/components and src/features), so it shows exactly what the real screens are
// built from, on real AniList data.
import { useMemo, useState } from 'react'
import { IntroHero } from '../components/IntroHero.tsx'
import { MangaPage } from '../components/MangaPage.tsx'
import { SiteHeader } from '../components/SiteHeader.tsx'
import { Strip } from '../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../components/TitleCard.tsx'
import type { Media } from '../features/anime/queries.ts'
import { PullMachine } from '../features/mood/PullMachine.tsx'
import type { Show, VariantProps } from './data.ts'

// The prototypes ask AniList for the fields they were drawn with (data.ts), with no synopsis,
// running time or tags, so the title card shows none.
const asMedia = (show: Show): Media => ({ ...show, description: null, duration: null, tags: [] })

export default function VariantD(props: VariantProps) {
  const [opened, setOpened] = useState<{ media: Media; from: DOMRect } | null>(null)
  const [search, setSearch] = useState('')
  const shows = useMemo(() => props.shows.map(asMedia), [props.shows])
  const classics = useMemo(() => props.classics.map(asMedia), [props.classics])
  const pool = useMemo(() => [...shows, ...classics], [shows, classics])
  const open: OpenTitle = (media, from) => setOpened({ media, from: from.getBoundingClientRect() })

  return (
    <div className="ab-app">
      <SiteHeader
        homeHref="?variant=D"
        links={[
          { href: '?variant=D', label: 'Discover', current: true },
          { href: '?variant=D#pull', label: 'Pull' },
        ]}
        search={search}
        onSearch={setSearch}
      />
      <main>
        <IntroHero
          titles={shows}
          actions={[
            { href: '#ab-trending', label: 'See what’s trending' },
            { href: '#pull', label: 'Pull a random title' },
            { href: '#ab-throwback', label: 'Browse the ’90s' },
          ]}
        />
        <MangaPage
          id="ab-trending"
          heading="Trending now"
          sfx="ドン!"
          titles={shows}
          onOpen={open}
        />
        <PullMachine pool={pool} onOpen={open} />
        <Strip
          id="ab-throwback"
          heading="Throwback: the ’90s"
          sfx="バーン"
          titles={classics}
          onOpen={open}
        />
      </main>
      <footer className="ab-foot">
        Data from AniList · Prototype D, built from the real components
      </footer>
      {opened && (
        <TitleCard
          key={opened.media.id}
          media={opened.media}
          from={opened.from}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  )
}
