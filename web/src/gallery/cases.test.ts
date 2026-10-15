import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDeepStrictEqual } from 'node:util'
import type { Media } from '../features/anime/queries.ts'
import { SAMPLES } from '../features/anime/samples.ts'
import { noteFor, searchStatus, statusText } from '../app/status.ts'
import { ECCHI_POOL, mediaOf, STATUS_CASES, TITLE_CASES } from './cases.ts'

/** The fields of `media` that differ from the sample with its id. */
function changed(media: Media, from: number) {
  const sample = SAMPLES.find((other) => other.id === from)
  assert.ok(sample, `no sample has the id ${from}`)
  return (Object.keys(sample) as (keyof Media)[]).filter(
    (field) => !isDeepStrictEqual(media[field], sample[field]),
  )
}

test('each case changes only the fields it names, and every one it names', () => {
  for (const edge of TITLE_CASES)
    assert.deepEqual(
      changed(mediaOf(edge), edge.from).sort(),
      Object.keys(edge.changes).sort(),
      edge.label,
    )
})

test('each case starts from a sample of its own, so no two titles in a list share an id', () => {
  const from = TITLE_CASES.map((edge) => edge.from)
  assert.equal(new Set(from).size, from.length, 'two cases start from the same sample')
})

test('the all-Ecchi pool is samples with Ecchi added to their genres, and nothing else', () => {
  assert.ok(ECCHI_POOL.length > 0, 'the pool is empty')
  for (const media of ECCHI_POOL) {
    assert.deepEqual(changed(media, media.id), ['genres'])
    assert.ok(media.genres.includes('Ecchi'), `${media.title.romaji} is not Ecchi`)
  }
})

test('no two status cases read alike, in the status line, the section note or the search', () => {
  const read = Object.values(STATUS_CASES).map(({ status, rateLimited = false }) =>
    [
      statusText(status, rateLimited),
      noteFor(status, rateLimited),
      searchStatus(status, 'frieren', rateLimited),
    ].join(' | '),
  )
  assert.equal(new Set(read).size, read.length, read.join('\n'))
})
