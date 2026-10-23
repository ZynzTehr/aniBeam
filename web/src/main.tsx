import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App.tsx'
import { loadListPage, preloadListPage } from './features/list/page.ts'
import { savedMotionChoice } from './lib/motion.ts'
import { persistOptions, queryClient } from './lib/queryClient.ts'
import { isListPath, pageBeneath } from './lib/route.ts'

// Development-only pages, opened by address: the Phase 2 design prototypes with ?variant=A|B|C,
// and the component gallery with ?gallery. In a production build import.meta.env.DEV is false, so
// these branches, their files and the checks of the address are left out entirely
// (privacy.test.ts makes sure).
const Prototype =
  import.meta.env.DEV && new URLSearchParams(location.search).has('variant')
    ? lazy(() => import('./prototype/Prototype.tsx'))
    : null
const Gallery =
  import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')
    ? lazy(() => import('./gallery/Gallery.tsx'))
    : null
const Page = Prototype ?? Gallery

// A visitor who turned motion off on the site keeps it off on later visits: the saved choice (see
// lib/motion.ts) puts data-motion="reduce" back on <html> before React draws anything. The page's
// entrances start as soon as it is drawn, so set any later, the setting would let them play.
if (savedMotionChoice()) document.documentElement.dataset.motion = 'reduce'

const render = () => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        {Page ? (
          <Suspense fallback={null}>
            <Page />
          </Suspense>
        ) : (
          <App />
        )}
      </PersistQueryClientProvider>
    </StrictMode>,
  )
  preloadListPage()
}

// My List's page is a file of its own (see features/list/page.ts). A visit that starts on it, or
// under a card opened over it, waits for that file before React first draws anything: drawn
// without it, the header and the footer would show alone, then the page would push the footer
// down. Should the file fail to load, the app draws as ever, and says so in the page's place.
if (!Page && isListPath(pageBeneath(location.pathname, history.state)))
  void loadListPage().then(render, render)
else render()
