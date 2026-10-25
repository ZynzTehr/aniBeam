import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Tag } from '../anime/queries.ts'
import { MOOD_MAP } from './moodMap.ts'
import { AXES, type Axis } from './moods.ts'
import { axisRaw, type Scored } from './score.ts'

type Titled = Scored & { id: number; name: string }

/** A tag as AniList sends it: no spoiler, not adult, unless `flags` say so. */
const tag = (name: string, rank: number | null, flags: Partial<Tag> = {}): Tag => ({
  name,
  rank,
  isAdult: false,
  isGeneralSpoiler: false,
  isMediaSpoiler: false,
  ...flags,
})
let made = 0
/** A title with `genres` and `tags`. */
const title = (genres: string[], tags: Tag[] = []): Titled => {
  const id = ++made
  return { id, name: `title ${id}`, genres, tags }
}
const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual}, not ${expected}`)

const AXIS_KEYS = Object.keys(AXES) as Axis[]

test('a genre at a slider’s high end adds 1.0, and one at its low end takes 1.0 away', () => {
  close(axisRaw(title(['Action']), 'energy'), 1, 'Action on Energy')
  close(axisRaw(title(['Slice of Life']), 'energy'), -1, 'Slice of Life on Energy')
  close(axisRaw(title(['Horror', 'Thriller']), 'tone'), 2, 'Horror and Thriller on Tone')
  close(axisRaw(title(['Romance', 'Drama']), 'tone'), 0, 'genres the map has no place for')
})

test('a title with Slice of Life and Action nets 0 Energy', () => {
  close(axisRaw(title(['Slice of Life', 'Action']), 'energy'), 0, 'Energy')
})

test('a tag counts its rank / 100, toward its end', () => {
  close(axisRaw(title([], [tag('Military', 45)]), 'energy'), 0.45, 'Military at 45')
  close(axisRaw(title([], [tag('Iyashikei', 90)]), 'energy'), -0.9, 'Iyashikei at 90')
  close(axisRaw(title([], [tag('Military', null)]), 'energy'), 0, 'a tag with no rank')
  close(
    axisRaw(title(['Comedy'], [tag('Death Game', 70), tag('Found Family', 20)]), 'tone'),
    -1 + 0.7 - 0.2,
    'Comedy, Death Game at 70 and Found Family at 20 on Tone',
  )
})

test('a spoiler Tragedy at rank 80 moves Tone by +0.8', () => {
  close(
    axisRaw(title([], [tag('Tragedy', 80, { isMediaSpoiler: true })]), 'tone'),
    0.8,
    'Tragedy, a spoiler for this title',
  )
  close(
    axisRaw(title([], [tag('Tragedy', 80, { isGeneralSpoiler: true })]), 'tone'),
    0.8,
    'Tragedy, a spoiler for any title',
  )
})

test('an adult tag never counts', () => {
  close(axisRaw(title([], [tag('Gore', 90, { isAdult: true })]), 'tone'), 0, 'adult Gore')
})

test('a name on two sliders counts once on each', () => {
  const cozy = title([], [tag('Iyashikei', 90), tag('Episodic', 50)])
  close(axisRaw(cozy, 'energy'), -1.4, 'Energy')
  close(axisRaw(cozy, 'tone'), -0.9, 'Tone, Iyashikei alone')
  close(axisRaw(cozy, 'complexity'), -0.5, 'Complexity, Episodic alone')
  close(axisRaw(title(['Psychological']), 'tone'), 1, 'Psychological on Tone')
  close(axisRaw(title(['Psychological']), 'complexity'), 1, 'Psychological on Complexity')
})

test('every name in the mood map moves its slider the way its end says', () => {
  for (const axis of AXIS_KEYS)
    for (const [end, sign] of [
      ['low', -1],
      ['high', 1],
    ] as const) {
      for (const genre of MOOD_MAP[axis][end].genres)
        close(axisRaw(title([genre]), axis), sign, `${genre} on ${axis}`)
      for (const name of MOOD_MAP[axis][end].tags)
        close(axisRaw(title([], [tag(name, 50)]), axis), sign * 0.5, `${name} on ${axis}`)
    }
})
