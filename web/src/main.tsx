import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App.tsx'
import { persistOptions, queryClient } from './lib/queryClient.ts'

// Phase 2 design prototypes, opened with ?variant=A|B|C. Development only: in a production
// build import.meta.env.DEV is false, so this branch and its files are left out entirely.
const Prototype = import.meta.env.DEV ? lazy(() => import('./prototype/Prototype.tsx')) : null
const showPrototype = new URLSearchParams(location.search).has('variant')

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
