import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from '../lib/anilist.ts'
import { noteFor, sampleNote, searchStatus, statusText, type QueryStatus } from './status.ts'

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
const serverError = new AniListError('Internal Server Error', 500)
// An error as the saved cache brings it back on a later visit: a plain object, not an Error.
const savedError = JSON.parse(JSON.stringify(new AniListError('API disabled', 403)))
const twoTitles = [{ id: 1 }, { id: 2 }]
// Saved lists come back for up to a day, so the line must say when the list was fetched, not
// the current time. statusText formats that time in the visitor's locale and time zone, so the
// expected time is formatted the same way.
const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000

// [situation, query state, requests held for a rate limit?, expected status line]
const cases: [string, Partial<QueryStatus>, boolean, string][] = [
  ['first load', { isFetching: true }, false, 'Loading…'],
  // TanStack reports a query held while offline as paused, never as fetching too.
  ['offline', { isPaused: true }, false, 'Offline: waiting for a connection.'],
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
  // A search that found a single title, refreshed hours later while AniList is down. One title
  // on screen may be out of date too: only an empty list reads like a failed first load.
  [
    'a failed refresh with one title on screen',
    { data: [{ id: 1 }], error: noConnection, failureReason: noConnection },
    false,
    'AniList isn’t responding right now, so these titles may be out of date. It’s not something you did.',
  ],
  // A search that found nothing, refreshed hours later while AniList is down.
  [
    'a failed refresh of an empty list',
    { data: [], error: noConnection, failureReason: noConnection },
    false,
    'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
  ],
  // A list whose refresh failed keeps its error while Try again runs, and while TanStack
  // retries it on its own (back on the tab, a new visit). If requests are held, it waits that
  // out first.
  [
    'Try again with an earlier list on screen',
    { data: twoTitles, error: noConnection, isFetching: true },
    false,
    'Trying AniList again…',
  ],
  [
    'trying again after a visit whose refresh failed',
    { data: twoTitles, error: savedError, isFetching: true },
    false,
    'Trying AniList again…',
  ],
  [
    'Try again on an empty list',
    { data: [], error: noConnection, isFetching: true },
    false,
    'Trying AniList again…',
  ],
  [
    'Try again waiting out a pause first',
    { data: twoTitles, error: noConnection, isFetching: true },
    true,
    'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
  ],
  // A server error is retried after 1, 2 and 4 seconds, with or without titles on screen. Its
  // line says why the list is held up, so it also wins over "Trying AniList again…". If requests
  // are held, the retry waits that out first.
  [
    'retrying a server error with an earlier list on screen',
    { data: twoTitles, isFetching: true, failureReason: serverError },
    false,
    'AniList had a problem. It’s not something you did. Trying again in a few seconds.',
  ],
  [
    'retrying a server error on a first load',
    { isFetching: true, failureReason: serverError },
    false,
    'AniList had a problem. It’s not something you did. Trying again in a few seconds.',
  ],
  [
    'Try again meeting a server error',
    { data: twoTitles, error: noConnection, isFetching: true, failureReason: serverError },
    false,
    'AniList had a problem. It’s not something you did. Trying again in a few seconds.',
  ],
  [
    'a server error retry waiting out a pause first',
    { data: twoTitles, isFetching: true, failureReason: serverError },
    true,
    'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
  ],
  ['an empty result', { data: [] }, false, 'No titles found.'],
  // Right after a list's last try, anilist() is still holding requests back, but nothing retries.
  [
    'a failed first load, just after its last try started a pause',
    { error: tooMany, failureReason: tooMany },
    true,
    'AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
  ],
  [
    'a failed refresh with an earlier list on screen, during the pause it started',
    { data: twoTitles, error: noConnection, failureReason: noConnection },
    true,
    'AniList isn’t responding right now, so these titles may be out of date. It’s not something you did.',
  ],
  ['an empty result while requests are held', { data: [] }, true, 'No titles found.'],
  [
    'a list being refreshed says when it was fetched',
    { data: twoTitles, isFetching: true, dataUpdatedAt: threeHoursAgo },
    false,
    `2 titles, fetched at ${new Date(threeHoursAgo).toLocaleTimeString()} (refreshing…)`,
  ],
]

for (const [situation, state, rateLimited, expected] of cases) {
  test(`status line: ${situation}`, () => {
    assert.equal(statusText({ ...idle, ...state }, rateLimited), expected)
  })
}

// The page shows a section's status line only when there is something to say.
test('note: quiet while the titles are on screen, even during a normal refresh', () => {
  assert.equal(noteFor({ ...idle, data: twoTitles }, false), null)
  // A search that finds a single title.
  assert.equal(noteFor({ ...idle, data: [{ id: 1 }] }, false), null)
  assert.equal(noteFor({ ...idle, data: twoTitles, isFetching: true }, false), null)
  // Another request's pause holds requests back, but this list isn't waiting on it.
  assert.equal(noteFor({ ...idle, data: twoTitles }, true), null)
})

test('note: says why a list is held up, with or without titles on screen', () => {
  const shortBreak =
    'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.'
  assert.equal(noteFor({ ...idle, data: twoTitles, isFetching: true }, true), shortBreak)
  assert.equal(noteFor({ ...idle, isFetching: true }, true), shortBreak)
  // The retry after a failed connection, still running once the one-minute pause is over.
  assert.equal(
    noteFor({ ...idle, data: twoTitles, isFetching: true, failureReason: noConnection }, false),
    'AniList isn’t responding right now. It’s not something you did. Trying again in a minute.',
  )
  // The retries after a server error, a few seconds apart.
  assert.equal(
    noteFor({ ...idle, data: twoTitles, isFetching: true, failureReason: serverError }, false),
    'AniList had a problem. It’s not something you did. Trying again in a few seconds.',
  )
})

test('note: speaks while loading, empty, failed, offline or held for a rate limit', () => {
  assert.equal(noteFor({ ...idle, isFetching: true }, false), 'Loading…')
  assert.equal(noteFor({ ...idle, data: [] }, false), 'No titles found.')
  assert.equal(
    noteFor({ ...idle, data: twoTitles, error: noConnection, failureReason: noConnection }, false),
    'AniList isn’t responding right now, so these titles may be out of date. It’s not something you did.',
  )
  // Then Try again: the titles stay on screen while it runs.
  assert.equal(
    noteFor({ ...idle, data: twoTitles, error: noConnection, isFetching: true }, false),
    'Trying AniList again…',
  )
  assert.equal(
    noteFor({ ...idle, data: twoTitles, isPaused: true }, false),
    'Offline: waiting for a connection.',
  )
  assert.equal(
    noteFor({ ...idle, data: twoTitles, isFetching: true, failureReason: tooMany }, true),
    'AniList is busy right now. It’s not something you did. Trying again within a minute.',
  )
})

// While a new decade loads, or a search that refines the last one, the previous list stays as
// a placeholder (with dataUpdatedAt 0). It is not this query's answer.
test('placeholder titles from the previous list never read as this list’s answer', () => {
  // The previous search found nothing: the new one is loading, not "No titles found."
  assert.equal(
    noteFor({ ...idle, data: [], isFetching: true, isPlaceholderData: true }, false),
    'Loading…',
  )
  // A retry behind the previous decade's titles: not "20 titles, fetched at <1970>".
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
    'AniList had a problem. It’s not something you did. Trying again in a few seconds.',
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

// A search held up by AniList reads as the section's own line; one that found titles says so,
// even while another request's pause holds requests back.
test('search announcements say why a search is held up', () => {
  assert.equal(
    searchStatus({ ...idle, isFetching: true }, 'zzz', true),
    'Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
  )
  assert.equal(
    searchStatus({ ...idle, isFetching: true, failureReason: noConnection }, 'zzz', false),
    'AniList isn’t responding right now. It’s not something you did. Trying again in a minute.',
  )
  // Try again on a saved search whose refresh failed.
  assert.equal(
    searchStatus(
      { ...idle, data: twoTitles, error: noConnection, isFetching: true },
      'frieren',
      false,
    ),
    'Trying AniList again…',
  )
  assert.equal(
    searchStatus({ ...idle, data: twoTitles }, 'frieren', true),
    '2 titles found for “frieren”',
  )
})

// A section that can't reach AniList shows sample titles instead (see App). Its line says what
// they are, then why its own titles are held up.
test('sample note: says what the samples are, then what AniList is doing', () => {
  const favorites = 'These are fan favorites, not this week’s trending.'
  assert.equal(
    sampleNote(favorites, { ...idle, isFetching: true, failureReason: noConnection }, false),
    'These are fan favorites, not this week’s trending. AniList isn’t responding right now. It’s not something you did. Trying again in a minute.',
  )
  assert.equal(
    sampleNote(favorites, { ...idle, error: noConnection, failureReason: noConnection }, false),
    'These are fan favorites, not this week’s trending. AniList, where AniBeam gets its anime, isn’t responding right now. It’s not something you did. Try again in a minute.',
  )
  // Try again: with no titles of its own, the list forgets the last failure, then waits out the
  // pause that failure started.
  assert.equal(
    sampleNote(favorites, { ...idle, isFetching: true }, true),
    'These are fan favorites, not this week’s trending. Taking a short break from AniList so it isn’t overloaded. It’s not something you did. Trying again within a minute.',
  )
  // Then the try goes out, at once after a refusal (403), which starts no pause. The samples show
  // only once a try has failed, so this is AniList tried again, not a first load.
  assert.equal(
    sampleNote(favorites, { ...idle, isFetching: true }, false),
    'These are fan favorites, not this week’s trending. Trying AniList again…',
  )
})
