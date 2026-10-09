import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from '../lib/anilist.ts'
import { noteFor, searchStatus, statusText, type QueryStatus } from './status.ts'

const idle: QueryStatus = {
  data: undefined,
  error: null,
  failureReason: null,
  isFetching: false,
  isPaused: false,
  isPlaceholderData: false,
  dataUpdatedAt: 0,
}
const tooMany = new AniListError('Too Many Requests.', 429)
const noConnection = new TypeError('Failed to fetch')
const twoTitles = [{ id: 1 }, { id: 2 }]

// [situation, query state, requests held for a rate limit?, expected status line]
const cases: [string, Partial<QueryStatus>, boolean, string | RegExp][] = [
  ['first load', { isFetching: true }, false, 'Loading…'],
  ['offline', { isFetching: true, isPaused: true }, false, 'Offline: waiting for a connection.'],
  [
    'retrying after a 429',
    { isFetching: true, failureReason: tooMany },
    true,
    'AniList is busy right now. It’s not something you did. Trying again within a minute.',
  ],
  [
    'retrying a 429 for a list that was empty',
    { data: [], isFetching: true, failureReason: tooMany },
    true,
    'AniList is busy right now. It’s not something you did. Trying again within a minute.',
  ],
  [
    'retrying after a failed connection',
    { isFetching: true, failureReason: noConnection },
    true,
    'AniList isn’t responding right now. It’s not something you did. Trying again in a minute.',
  ],
  [
    'waiting behind a pause another request started',
    { isFetching: true },
    true,
    'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
  ],
  [
    'a failed first load',
    { error: tooMany, failureReason: tooMany },
    false,
    'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
  ],
  [
    'a failed refresh with an earlier list on screen',
    { data: twoTitles, error: noConnection, failureReason: noConnection },
    false,
    'AniList isn’t responding right now, so these titles may be out of date. It’s not something you did.',
  ],
  ['an empty result', { data: [] }, false, 'No titles found.'],
  [
    'a list being refreshed',
    { data: twoTitles, isFetching: true },
    false,
    /^2 titles, fetched at .+ \(refreshing…\)$/,
  ],
]

for (const [situation, state, rateLimited, expected] of cases) {
  test(`status line: ${situation}`, () => {
    const text = statusText({ ...idle, ...state }, rateLimited)
    if (expected instanceof RegExp) assert.match(text, expected)
    else assert.equal(text, expected)
  })
}

// The page shows a section's status line only when there is something to say.
test('note: quiet while the titles are on screen, even during a normal refresh', () => {
  assert.equal(noteFor({ ...idle, data: twoTitles }, false), null)
  assert.equal(noteFor({ ...idle, data: twoTitles, isFetching: true }, false), null)
})

test('note: speaks while loading, empty, failed, offline or held for a rate limit', () => {
  assert.equal(noteFor({ ...idle, isFetching: true }, false), 'Loading…')
  assert.equal(noteFor({ ...idle, data: [] }, false), 'No titles found.')
  assert.equal(
    noteFor({ ...idle, data: twoTitles, error: noConnection, failureReason: noConnection }, false),
    'AniList isn’t responding right now, so these titles may be out of date. It’s not something you did.',
  )
  assert.equal(
    noteFor({ ...idle, data: twoTitles, isFetching: true, isPaused: true }, false),
    'Offline: waiting for a connection.',
  )
  assert.equal(
    noteFor({ ...idle, data: twoTitles, isFetching: true, failureReason: tooMany }, true),
    'AniList is busy right now. It’s not something you did. Trying again within a minute.',
  )
})

// While a new decade or search loads, keepPreviousData shows the previous list as a
// placeholder (with dataUpdatedAt 0). It is not this query's answer.
test('placeholder titles from the previous list never read as this list’s answer', () => {
  // The previous search found nothing: the new one is loading, not "No titles found."
  assert.equal(
    noteFor({ ...idle, data: [], isFetching: true, isPlaceholderData: true }, false),
    'Loading…',
  )
  // A retry behind the previous decade's titles: not "20 titles, fetched at <1970>".
  const serverError = new AniListError('Internal Server Error', 500)
  assert.equal(
    statusText(
      {
        ...idle,
        data: twoTitles,
        isFetching: true,
        isPlaceholderData: true,
        failureReason: serverError,
      },
      false,
    ),
    'Loading…',
  )
})

// What a screen reader hears about a search. The term is in every message, so two searches
// with the same outcome still change the text, and each one gets announced.
test('search announcements name the search and what it found', () => {
  const one = [{ id: 1 }]
  assert.equal(
    searchStatus({ ...idle, isFetching: true }, 'frieren', false),
    'Searching for “frieren”…',
  )
  assert.equal(
    searchStatus(
      { ...idle, data: twoTitles, isFetching: true, isPlaceholderData: true },
      'frieren b',
      false,
    ),
    'Searching for “frieren b”…',
  )
  assert.equal(
    searchStatus({ ...idle, data: twoTitles }, 'frieren', false),
    '2 titles found for “frieren”',
  )
  assert.equal(
    searchStatus({ ...idle, data: one }, 'mushishi', false),
    '1 title found for “mushishi”',
  )
  assert.equal(searchStatus({ ...idle, data: [] }, 'zzz', false), 'No titles found for “zzz”')
  assert.equal(
    searchStatus({ ...idle, isPaused: true }, 'zzz', false),
    'Offline: waiting for a connection.',
  )
  assert.match(
    searchStatus({ ...idle, error: noConnection }, 'zzz', false),
    /isn’t responding right now/,
  )
})
