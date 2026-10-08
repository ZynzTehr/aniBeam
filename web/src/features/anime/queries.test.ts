import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ERAS, QUERIES } from './queries.ts'

test('every media query excludes adult titles', () => {
  for (const [name, query] of Object.entries(QUERIES)) {
    const mediaArguments = [...query.matchAll(/\bmedia\(([^)]*)\)/gi)].map((match) => match[1])
    assert.ok(mediaArguments.length > 0, `${name} has no media query`)
    for (const args of mediaArguments) {
      assert.match(args, /isAdult: false/, `${name} is missing isAdult: false`)
      assert.match(args, /genre_not_in: \["Hentai"\]/, `${name} is missing the Hentai exclusion`)
    }
  }
})

test('the 1980s cover 1980-01-01 through 1989-12-31, including year-only dates', () => {
  const eighties = ERAS.find((era) => era.id === '1980s')
  assert.deepEqual(eighties?.variables, { from: 19799999, to: 19900000 })
})

test('eras run from pre-1970 to upcoming without gaps', () => {
  assert.deepEqual(
    ERAS.map((era) => era.id),
    ['pre-1970', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s', 'upcoming'],
  )
  for (let i = 1; i < ERAS.length - 1; i++) {
    const previousEnd = ERAS[i - 1].variables.to as number
    assert.equal(
      ERAS[i].variables.from,
      previousEnd - 1,
      `${ERAS[i].id} does not start where ${ERAS[i - 1].id} ends`,
    )
  }
})
