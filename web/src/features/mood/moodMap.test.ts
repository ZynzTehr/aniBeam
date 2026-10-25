import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MOOD_MAP } from './moodMap.ts'
import { AXES, type Axis } from './moods.ts'

// AniList's 19 genres, its GenreCollection. Every query leaves Hentai out, and the pool Ecchi.
const GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Hentai',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
]

// Every tag name in the browser checks' recordings (see recorded.json's note), standing in for
// AniList's own tag list until it is recorded (REC-1).
const recorded: { tags: string[] } = JSON.parse(
  readFileSync(new URL('./recorded.json', import.meta.url), 'utf8'),
)

// Spec §3C's tags that no recorded title has, so the recordings can't vouch for their spelling.
// They wait for REC-1 to confirm them; until then, any other name the recordings lack fails.
const UNCONFIRMED = ['Camping', 'Athletics', 'Parenthood']

const AXIS_KEYS = Object.keys(AXES) as Axis[]
const ends = AXIS_KEYS.flatMap((axis) =>
  (['low', 'high'] as const).map((end) => ({ where: `${axis} ${end}`, ...MOOD_MAP[axis][end] })),
)

test('the mood map has a low and a high end for each slider', () => {
  assert.deepEqual(Object.keys(MOOD_MAP), AXIS_KEYS)
  for (const { where, genres, tags } of ends)
    assert.ok(genres.length + tags.length > 0, `${where} names nothing`)
})

test('every tag the mood map names is a real AniList tag, spelt as AniList spells it', () => {
  // A misspelt name would never match a title, and would silently score 0.
  const known = new Set(recorded.tags)
  assert.ok(known.size > 250, `only ${known.size} recorded tag names`)
  const missing = ends.flatMap(({ where, tags }) =>
    tags.filter((tag) => !known.has(tag)).map((tag) => `${tag} (${where})`),
  )
  assert.deepEqual(
    missing.filter((name) => !UNCONFIRMED.some((tag) => name.startsWith(`${tag} (`))),
    [],
    'these mapped tags are in no recording: misspelt?',
  )
  // And each unconfirmed name is still missing from the recordings and still mapped: once a
  // recording has it, it is confirmed and comes off the list.
  assert.deepEqual(
    UNCONFIRMED.filter((tag) => known.has(tag) || !ends.some(({ tags }) => tags.includes(tag))),
    [],
    'these are no longer unconfirmed tags',
  )
})

test('every genre the mood map names is one of AniList’s 19, and never Ecchi or Hentai', () => {
  assert.equal(new Set(GENRES).size, 19)
  const wrong = ends.flatMap(({ where, genres }) =>
    genres
      .filter((genre) => !GENRES.includes(genre) || genre === 'Ecchi' || genre === 'Hentai')
      .map((genre) => `${genre} (${where})`),
  )
  assert.deepEqual(wrong, [], 'these mapped genres are not allowed')
})

test('no name sits at both ends of one slider, and only five sit on two sliders', () => {
  // At both ends a name would cancel itself out. On two sliders it counts once on each, as
  // spec §3C lists it.
  for (const axis of AXIS_KEYS) {
    const { low, high } = MOOD_MAP[axis]
    const both = [...low.genres, ...low.tags].filter((name) =>
      [...high.genres, ...high.tags].includes(name),
    )
    assert.deepEqual(both, [], `at both ends of ${axis}`)
  }
  const sliders = new Map<string, Axis[]>()
  for (const axis of AXIS_KEYS)
    for (const end of [MOOD_MAP[axis].low, MOOD_MAP[axis].high])
      for (const name of [...end.genres, ...end.tags])
        sliders.set(name, [...(sliders.get(name) ?? []), axis])
  const shared = Object.fromEntries([...sliders].filter(([, axes]) => axes.length > 1))
  assert.deepEqual(shared, {
    Iyashikei: ['energy', 'tone'],
    'Cute Girls Doing Cute Things': ['energy', 'complexity'],
    Episodic: ['energy', 'complexity'],
    Slapstick: ['tone', 'complexity'],
    Psychological: ['tone', 'complexity'],
  })
})
