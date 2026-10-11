import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AniListError } from '../../lib/anilist.ts'
import { loadSamples, outOfReach, samplesFor, sharedLoad } from './fallback.ts'
import { ERAS, type Media } from './queries.ts'
import { SAMPLES } from './samples.ts'

const fromYear = (seasonYear: number) => ({ id: seasonYear, seasonYear }) as Media

test('samplesFor finds the titles from each era, its first and last year included', () => {
  const years = [1917, 1969, 1970, 1979, 1980, 1989, 1990, 1999, 2000, 2009, 2010, 2019, 2020, 2026]
  const titles = years.map(fromYear)
  assert.deepEqual(
    Object.fromEntries(
      ERAS.map((era) => [era.id, samplesFor(titles, era).map((media) => media.seasonYear)]),
    ),
    {
      'pre-1970': [1917, 1969],
      '1970s': [1970, 1979],
      '1980s': [1980, 1989],
      '1990s': [1990, 1999],
      '2000s': [2000, 2009],
      '2010s': [2010, 2019],
      '2020s': [2020, 2026],
      upcoming: [],
    },
  )
})

// Only the failures spec §3H names bring out the samples: a server error or a bad request doesn't.
test('outOfReach is true for a failed connection, a refusal and the rate limit only', () => {
  const rows: [string, unknown, boolean][] = [
    ['a failed connection', new TypeError('Failed to fetch'), true],
    ['a refusal (403)', new AniListError('Forbidden', 403), true],
    ['the rate limit (429)', new AniListError('Too Many Requests.', 429), true],
    ['a bad request (400)', new AniListError('Bad Request', 400), false],
    ['a missing page (404)', new AniListError('Not Found', 404), false],
    ['a server error (500)', new AniListError('Internal Server Error', 500), false],
    ['a cancelled request', new DOMException('This operation was aborted', 'AbortError'), false],
    ['no error', null, false],
  ]
  for (const [name, error, expected] of rows) {
    assert.equal(
      outOfReach(error),
      expected,
      `${name} ${expected ? 'should' : 'shouldn’t'} count as out of reach`,
    )
  }
})

test('the samples load once, however often they are asked for', async () => {
  const loading = loadSamples()
  assert.equal(loadSamples(), loading, 'a second call loaded them again')
  assert.equal(await loading, SAMPLES)
})

test('a shared load runs once, and after a failure the next call tries again', async () => {
  let calls = 0
  const load = sharedLoad(async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch')
    return SAMPLES
  })
  const first = load()
  assert.equal(load(), first, 'a call while the load ran started another')
  await assert.rejects(first, TypeError)
  const retried = await load().catch((error: unknown) => error)
  assert.equal(retried, SAMPLES, 'after the load failed, the next call got its error again')
  assert.equal(await load(), SAMPLES)
  assert.equal(calls, 2, `ran the load ${calls} times, not twice`)
})
