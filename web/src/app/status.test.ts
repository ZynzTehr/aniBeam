import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from '../lib/anilist.ts'
import { statusText, type QueryStatus } from './status.ts'

const idle: QueryStatus = {
  data: undefined,
  error: null,
  failureReason: null,
  isFetching: false,
  isPaused: false,
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
    'AniList rate limit reached; retrying automatically when it resets.',
  ],
  [
    'retrying a 429 for a list that was empty',
    { data: [], isFetching: true, failureReason: tooMany },
    true,
    'AniList rate limit reached; retrying automatically when it resets.',
  ],
  [
    'retrying after a failed connection',
    { isFetching: true, failureReason: noConnection },
    true,
    "Can't reach AniList right now; retrying automatically in a minute.",
  ],
  [
    'waiting behind a pause another request started',
    { isFetching: true },
    true,
    'Waiting a minute before contacting AniList again.',
  ],
  [
    'a failed first load',
    { error: tooMany, failureReason: tooMany },
    false,
    'Error: Too Many Requests.',
  ],
  [
    'a failed refresh with an earlier list on screen',
    { data: twoTitles, error: noConnection, failureReason: noConnection },
    false,
    'Error: Failed to fetch (showing earlier results)',
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
