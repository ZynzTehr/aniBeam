import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { MangaPage } from '../../components/MangaPage.tsx'
import { StampDraw } from '../../components/stampDraw.ts'
import { Strip } from '../../components/Strip.tsx'
import { TitleCard, type OpenTitle } from '../../components/TitleCard.tsx'
import { SAMPLES } from '../../features/anime/samples.ts'
import { listQuery, type Media } from '../../features/anime/queries.ts'
import { loaded, loadListPage } from '../../features/list/page.ts'
import { KEY, listedIds } from '../../features/list/store.ts'
import { PullMachine } from '../../features/mood/PullMachine.tsx'
import { FRESH, setSession } from '../../features/mood/session.ts'
import { LANDING_PARTS, startLanding } from '../../lib/landing.ts'
import { push } from '../../lib/route.ts'
import { LabStamp } from './LabStamp.tsx'
import { LabOptions } from './options.ts'
import { COVERS, refusedRequests, spokenName, tabStops, watchShift } from './page.ts'
import { DECADE, SEARCH, TRENDING } from './sandbox.ts'
import { read, SECTIONS, type Options, type View } from './switches.ts'

/** What the stage reports to the shell, which shows it in its readout line. */
export type Report = {
  requests: number
  stops: number
  stopsBare: number
  heard: string
  shift: number | null
  matches: number[]
}

/** The shell's messages: the choices and the view, or a section to scroll to. */
export type Message =
  { type: 'ab-lab'; options: Options; view: View } | { type: 'ab-lab-jump'; section: number }

// Its own answers, never saved: the site's saved answers are left as they are. Nothing is asked
// for: My List's answer is put in from the samples (see SeededList), and every other surface is
// handed its titles.
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})

// Layout shift on the stage, from its first change (see watchShift).
let watching: ReturnType<typeof watchShift> | undefined
const shifts = () => (watching ??= watchShift())

// The machine's sliders, set so the top 3 show with their Why lines.
setSession({ ...FRESH, sliders: { energy: 2, tone: -1, complexity: 0 } })

/**
 * The lab's stage, in the shell's frame at the width the shell gives it: the site's own surfaces,
 * drawn from the bundled samples, one after another. A cover opens the real title card, whose
 * list controls edit the lab's list. It starts from the address and follows the shell's messages.
 */
export function Stage() {
  const [{ options, view }, setShown] = useState(() => read(new URLSearchParams(location.search)))
  useEffect(() => {
    const heard = ({ origin, data }: MessageEvent<Message>) => {
      if (origin !== location.origin) return
      if (data?.type === 'ab-lab') {
        shifts().reset()
        setShown({ options: data.options, view: data.view })
      } else if (data?.type === 'ab-lab-jump')
        document.getElementById(`ab-lab-s${data.section}`)?.scrollIntoView({ block: 'start' })
    }
    // A change to the lab's list from the shell is a change too.
    const changed = ({ key }: StorageEvent) => {
      if (key === KEY) shifts().reset()
    }
    addEventListener('message', heard)
    addEventListener('storage', changed)
    return () => {
      removeEventListener('message', heard)
      removeEventListener('storage', changed)
    }
  }, [])

  // The lab's Reduce motion: the site's own setting, for this frame only, so the visitor's saved
  // choice stays as it was. And the clip boxes, outlined.
  useLayoutEffect(() => {
    const root = document.documentElement
    if (view.motion === 'reduce') root.dataset.motion = 'reduce'
    else delete root.dataset.motion
    root.toggleAttribute('data-lab-clips', view.clips)
  }, [view.motion, view.clips])

  // Parts slam in once as they scroll into view, as on the site.
  useLayoutEffect(() => startLanding(LANDING_PARTS), [])

  const [card, setCard] = useState<{ media: Media; from: DOMRect } | null>(null)
  const open: OpenTitle = (media, from) => setCard({ media, from: from.getBoundingClientRect() })

  useReports()
  useLinksStayInLab()

  return (
    <QueryClientProvider client={client}>
      <LabOptions.Provider value={options}>
        <StampDraw.Provider value={LabStamp}>
          <div className="ab-app ab-lab-page">
            <title>Stage · Stamps lab</title>
            <main id="main">
              <Section n={1}>
                <MangaPage
                  id="ab-trending"
                  heading="Trending now"
                  sfx="ドン!"
                  titles={TRENDING}
                  onOpen={open}
                />
              </Section>
              <Section n={2}>
                <Strip
                  id="decades"
                  heading="Browse by decade"
                  sfx="バーン"
                  titles={DECADE}
                  onOpen={open}
                />
              </Section>
              <Section n={3}>
                <div className="ab-results">
                  <Strip
                    id="results"
                    level="h1"
                    heading="Results for “the”"
                    sfx="サーチ!"
                    titles={SEARCH}
                    onOpen={open}
                    live={false}
                    grid
                  />
                </div>
              </Section>
              <Section n={4}>
                <PullMachine era={null} titles={SAMPLES} settled={false} onOpen={open} />
              </Section>
              <Section n={5}>
                <LabList onOpen={open} covered={card !== null} />
              </Section>
            </main>
            {card && (
              <TitleCard
                key={card.media.id}
                media={card.media}
                from={card.from}
                onClose={() => setCard(null)}
              />
            )}
          </div>
        </StampDraw.Provider>
      </LabOptions.Provider>
    </QueryClientProvider>
  )
}

function Section({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div id={`ab-lab-s${n}`} className="ab-lab-section">
      <p className="ab-lab-section-name">
        {n}. {SECTIONS[n - 1]}
      </p>
      {children}
    </div>
  )
}

/**
 * My List's real page, from its own file as on the site. It takes the list's titles as it opens,
 * as on the site, so a change from the shell draws it again, as a visit would; an edit in a card
 * opened here keeps it as it is, as on the site.
 */
function LabList(props: { onOpen: OpenTitle; covered: boolean }) {
  const [page, setPage] = useState(() => loaded.ListPage)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!page) void loadListPage().then((ListPage) => setPage(() => ListPage))
    // After the store has heard the same event, whichever listens first.
    const changed = ({ key }: StorageEvent) => {
      if (key === KEY) setTimeout(() => setRound((n) => n + 1))
    }
    addEventListener('storage', changed)
    return () => removeEventListener('storage', changed)
  }, [page])
  return page ? <SeededList key={round} page={page} {...props} /> : null
}

/** My List's page, with AniList's answer for its titles put in from the samples beforehand. */
function SeededList({
  page: ListPage,
  ...props
}: {
  page: NonNullable<typeof loaded.ListPage>
  onOpen: OpenTitle
  covered: boolean
}) {
  const answers = useQueryClient()
  useState(() => {
    const ids = listedIds().slice(0, 50)
    if (ids.length)
      answers.setQueryData(
        listQuery(ids).queryKey,
        SAMPLES.filter(({ id }) => ids.includes(id)),
      )
  })
  return <ListPage {...props} />
}

/**
 * My List's tabs and Favorites only change the address, as on the site: here each keeps the lab's
 * address, so the stage stays the stage on a reload. Its "Browse what's trending" scrolls to the
 * trending page above.
 */
function useLinksStayInLab() {
  useEffect(() => {
    const clicked = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('.ab-list a[href]')
      const href = link?.getAttribute('href')
      if (!href || link?.closest('.ab-strip-row')) return
      event.preventDefault()
      event.stopPropagation()
      if (href.startsWith('/list')) {
        const to = new URL(href, location.origin)
        to.searchParams.set('proto', 'stamps')
        to.searchParams.set('stage', '1')
        push(`${to.pathname}${to.search}`, null)
      } else document.getElementById('ab-lab-s1')?.scrollIntoView({ block: 'start' })
    }
    document.addEventListener('click', clicked, true)
    return () => document.removeEventListener('click', clicked, true)
  }, [])
}

/** Tells the shell what its readout line shows, each time it changes. */
function useReports() {
  useEffect(() => {
    let last = ''
    let cover: Element | null = null
    const noted = (event: Event) => {
      const found = (event.target as Element).closest?.(COVERS)
      if (found) cover = found
    }
    const send = () => {
      const main = document.getElementById('main')
      if (!main) return
      const stops = tabStops(main)
      const report: Report = {
        requests: refusedRequests(),
        stops: stops.length,
        stopsBare: stops.filter((stop) => !stop.closest('.ab-lab-stamp')).length,
        heard: cover?.isConnected ? spokenName(cover) : '',
        shift: shifts().read(),
        matches: [...document.querySelectorAll('.ab-match[href]')].map((link) =>
          Number(link.getAttribute('href')!.split('/').pop()),
        ),
      }
      const text = JSON.stringify(report)
      if (text === last) return
      last = text
      parent.postMessage({ type: 'ab-lab-report', report }, location.origin)
    }
    document.addEventListener('focusin', noted)
    document.addEventListener('pointerover', noted)
    const timer = setInterval(send, 300)
    return () => {
      clearInterval(timer)
      document.removeEventListener('focusin', noted)
      document.removeEventListener('pointerover', noted)
    }
  }, [])
}
