import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ERAS, eraQuery, searchQuery, trendingQuery } from '../features/anime/queries.ts'
import { AniListError } from '../lib/anilist.ts'
import { useDebounced } from '../lib/useDebounced.ts'

// Phase 1 debug page: proves the AniList client and saved cache work.
// Deliberately plain; the visual design is decided in Phase 2.
export default function App() {
  const [listId, setListId] = useState('trending')
  const [search, setSearch] = useState('')
  const term = useDebounced(search.trim(), 300)

  const searching = term.length >= 2
  const era = ERAS.find((e) => e.id === listId)
  const { data, error, failureReason, isPending, isFetching, dataUpdatedAt } = useQuery(
    searching ? searchQuery(term) : era ? eraQuery(era) : trendingQuery(),
  )

  const showing = searching ? `Search: "${term}"` : (era?.label ?? 'Trending now')
  const rateLimited = failureReason instanceof AniListError && failureReason.status === 429
  const status = error
    ? `Error: ${error.message}`
    : rateLimited
      ? 'AniList rate limit reached; retrying automatically when it resets.'
      : isPending
        ? 'Loading…'
        : `${data.length} titles, fetched at ${new Date(dataUpdatedAt).toLocaleTimeString()}${isFetching ? ' (refreshing…)' : ''}`

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">AniBeam: AniList debug page</h1>
        <p className="text-neutral-400">
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
            className="border border-neutral-600 bg-neutral-900 px-2 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          List (when not searching)
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className="border border-neutral-600 bg-neutral-900 px-2 py-2"
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
        <p role="status" className="text-neutral-400">
          {data?.length === 0 ? 'No titles found.' : status}
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
              <span className="text-neutral-400">
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
