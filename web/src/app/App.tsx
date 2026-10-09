import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ERAS, eraQuery, searchQuery, trendingQuery } from '../features/anime/queries.ts'
import { isRateLimited } from '../lib/anilist.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import { statusText } from './status.ts'

// Phase 1 debug page: proves the AniList client and saved cache work.
// Deliberately plain; the visual design is decided in Phase 2.
export default function App() {
  const [listId, setListId] = useState('trending')
  const [search, setSearch] = useState('')
  const term = useDebounced(search.trim(), 300)

  // Arrowing through the picker changes it once per option; wait like search does.
  const list = useDebounced(listId, 300)

  const searching = term.length >= 2
  const era = ERAS.find((e) => e.id === list)
  const { data, error, failureReason, isFetching, isPaused, dataUpdatedAt } = useQuery(
    searching ? searchQuery(term) : era ? eraQuery(era) : trendingQuery(),
  )

  const showing = searching ? `Search: "${term}"` : (era?.label ?? 'Trending now')
  const status = statusText(
    { data, error, failureReason, isFetching, isPaused, dataUpdatedAt },
    isRateLimited(),
  )

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">AniBeam: AniList debug page</h1>
        <p className="text-ink/70">
          Phase 1 check of the API client and saved cache. The real design comes in Phase 2.
        </p>
      </header>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          Search titles (2+ characters)
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-2 border-ink bg-white px-2 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          List (when not searching)
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="border-2 border-ink bg-white px-2 py-2"
          >
            <option value="trending">Trending now</option>
            {ERAS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section aria-labelledby="results-heading" className="space-y-2">
        <h2 id="results-heading" className="text-lg font-semibold">
          {showing}
        </h2>
        <p role="status" className="text-ink/70">
          {status}
        </p>
        <ol className="list-decimal space-y-1 pl-6">
          {data?.map((media) => (
            <li key={media.id}>
              <span
                aria-hidden="true"
                className="mr-2 inline-block size-3 rounded-full align-middle"
                style={{ backgroundColor: media.coverImage.color ?? 'transparent' }}
              />
              {media.title.english ?? media.title.romaji}
              <span className="text-ink/70">
                {' '}
                · {media.seasonYear ?? 'year unknown'} · {media.format ?? 'format unknown'} · score{' '}
                {media.averageScore ?? 'none'}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
