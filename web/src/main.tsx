import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App.tsx'
import { savedMotionChoice } from './lib/motion.ts'
import { persistOptions, queryClient } from './lib/queryClient.ts'

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
