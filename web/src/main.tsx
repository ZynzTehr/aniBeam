import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App.tsx'
import { savedMotionChoice } from './lib/motion.ts'
import { persistOptions, queryClient } from './lib/queryClient.ts'

// Phase 2 design prototypes, opened with ?variant=A|B|C. Development only: in a production
// build import.meta.env.DEV is false, so this branch and its files are left out entirely.
const Prototype = import.meta.env.DEV ? lazy(() => import('./prototype/Prototype.tsx')) : null
const showPrototype = new URLSearchParams(location.search).has('variant')

// A visitor who turned motion off on the site keeps it off on later visits: the saved choice (see
// lib/motion.ts) puts data-motion="reduce" back on <html> before React draws anything. The page's
// entrances start as soon as it is drawn, so set any later, the setting would let them play.
if (savedMotionChoice()) document.documentElement.dataset.motion = 'reduce'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {Prototype && showPrototype ? (
        <Suspense fallback={null}>
          <Prototype />
        </Suspense>
      ) : (
        <App />
      )}
    </PersistQueryClientProvider>
  </StrictMode>,
)
