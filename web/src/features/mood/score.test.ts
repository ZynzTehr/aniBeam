import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Tag } from '../anime/queries.ts'
import { MOOD_MAP } from './moodMap.ts'
import { AXES, type Axis, type Stop } from './moods.ts'
import { axisRaw, K, normalise, rankMatches, type Scored, type Sliders, whyOf } from './score.ts'

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

// The titles in the browser checks' recordings, each once (see recorded.json's note), with their
// tags as AniList sent them.
const RECORDED: Titled[] = (
  JSON.parse(readFileSync(new URL('./recorded.json', import.meta.url), 'utf8')).titles as {
    id: number
    name: string
    genres: string[]
    tags: [string, number, number][]
  }[]
).map(({ tags, ...media }) => ({
  ...media,
  tags: tags.map(([name, rank, flags]) =>
    tag(name, rank, {
      isGeneralSpoiler: Boolean(flags & 1),
      isMediaSpoiler: Boolean(flags & 2),
      isAdult: Boolean(flags & 4),
    }),
  ),
}))
const recorded = (id: number) => {
  const found = RECORDED.find((media) => media.id === id)
  assert.ok(found, `title ${id} is in no recording`)
  return found
}
const MUSHISHI = 457
const ATTACK_ON_TITAN = 16498
const EVANGELION = 30
const LAIN = 339
const DRAGON_HALF = 870 // a slapstick comedy: Comedy, Parody 92 and Slapstick 82
const SAINT_SEIYA = 1254 // its one dark tag is Tragedy, a spoiler

const AXIS_KEYS = Object.keys(AXES) as Axis[]
const STOPS: Stop[] = [-2, -1, 0, 1, 2]
const NONE: Sliders = { energy: 0, tone: 0, complexity: 0 }
/** Every setting of the three sliders, 125 of them. */
const SETTINGS: Sliders[] = STOPS.flatMap((energy) =>
  STOPS.flatMap((tone) => STOPS.map((complexity) => ({ energy, tone, complexity }))),
)

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

test('normalise squeezes a raw score onto -2 to 2, keeping its order and never cutting it off', () => {
  close(normalise(0), 0, 'no lean')
  close(normalise(-1.2), -normalise(1.2), 'the two ends alike')
  const raws = [-6, -4, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 4, 6]
  const scores = raws.map(normalise)
  for (let i = 1; i < scores.length; i++)
    assert.ok(scores[i] > scores[i - 1], `${raws[i]} scores no higher than ${raws[i - 1]}`)
  assert.ok(
    scores.every((score) => Math.abs(score) < 2),
    `past the scale: ${scores}`,
  )
  // Raw scores past the scale's end still keep apart (cut off at 2, 3 and 4 would tie).
  assert.ok(normalise(4) - normalise(3) > 0.01, 'raw 3 and 4 nearly tie')
  close(normalise(K), 2 * Math.tanh(1), 'the squash is 2 x tanh(raw / K)')
})

/** Where `id` comes in `pool` ranked for `sliders`. */
const placeOf = (pool: Titled[], sliders: Sliders, id: number) =>
  rankMatches(pool, sliders).findIndex((media) => media.id === id)
/** Whether `a` ranks before `b` for `sliders`, among every recorded title. */
const before = (sliders: Partial<Sliders>, a: number, b: number) => {
  const set = { ...NONE, ...sliders }
  const [first, second] = [placeOf(RECORDED, set, a), placeOf(RECORDED, set, b)]
  assert.ok(first >= 0 && second >= 0, `${a} or ${b} is missing from the ranking`)
  assert.ok(
    first < second,
    `at ${JSON.stringify(sliders)}, ${recorded(a).name} comes ${first + 1}th, after ` +
      `${recorded(b).name} (${second + 1}th)`,
  )
}

// The golden pairs: what should rank before what, among the recorded titles. Pairs, not scores,
// so that a change to K or a weight changes one line, not these.
test('Mushishi is cozier than Attack on Titan', () => {
  before({ energy: -2 }, MUSHISHI, ATTACK_ON_TITAN)
  before({ energy: 2 }, ATTACK_ON_TITAN, MUSHISHI)
})

test('Evangelion is darker than Mushishi', () => {
  before({ tone: 2 }, EVANGELION, MUSHISHI)
  before({ tone: -2 }, MUSHISHI, EVANGELION)
})

test('Serial Experiments Lain is more cerebral than a slapstick comedy', () => {
  before({ complexity: 2 }, LAIN, DRAGON_HALF)
  before({ complexity: -2 }, DRAGON_HALF, LAIN)
})

test('a title whose only dark tag is a spoiler Tragedy still scores dark', () => {
  const seiya = recorded(SAINT_SEIYA)
  const dark = seiya.tags.filter((tag) => MOOD_MAP.tone.high.tags.includes(tag.name))
  assert.deepEqual(
    dark.map(({ name, isGeneralSpoiler, isMediaSpoiler }) => ({
      name,
      spoiler: Boolean(isGeneralSpoiler || isMediaSpoiler),
    })),
    [{ name: 'Tragedy', spoiler: true }],
    'Saint Seiya’s dark tags',
  )
  assert.ok(normalise(axisRaw(seiya, 'tone')) > 0.5, 'Saint Seiya scores no darker than neutral')
})

test('each Energy stop has its own first match', () => {
  const pool = RECORDED.filter((media) => !media.genres.includes('Ecchi'))
  const firsts = STOPS.map((energy) => rankMatches(pool, { ...NONE, energy })[0].name)
  assert.equal(new Set(firsts).size, 5, `first matches from Very cozy up: ${firsts.join(', ')}`)
})

test('with every slider at No preference, the pool comes back in its own order', () => {
  assert.deepEqual(rankMatches(RECORDED, NONE), RECORDED)
  const reversed = RECORDED.toReversed()
  assert.deepEqual(rankMatches(reversed, NONE), reversed)
})

test('titles equally close keep the pool’s order', () => {
  // Two titles alike to the sliders, in either order, and another farther off at every setting
  // with High-octane set.
  const a = title(['Action'])
  const b = title(['Action'])
  const far = title(['Slice of Life'])
  for (const sliders of SETTINGS.filter(({ energy }) => energy > 0)) {
    assert.deepEqual(
      rankMatches([a, b, far], sliders)
        .map(({ id }) => id)
        .slice(0, 2),
      [a.id, b.id],
    )
    assert.deepEqual(
      rankMatches([b, far, a], sliders)
        .map(({ id }) => id)
        .slice(0, 2),
      [b.id, a.id],
    )
  }
})

test('a slider at No preference is left out, not read as a wish for the middle', () => {
  // Alike on Energy, and far apart on Tone: with Tone at No preference they tie, so the pool's
  // order stands, whichever comes first. Read as a wish for the middle, the neutral one would
  // always win.
  const dark = title(['Action', 'Horror', 'Thriller'], [tag('Gore', 90)])
  const neutral = title(['Action'])
  for (const energy of [-2, -1, 1, 2] as const) {
    const sliders = { ...NONE, energy }
    assert.deepEqual(rankMatches([dark, neutral], sliders), [dark, neutral], `at ${energy}`)
    assert.deepEqual(rankMatches([neutral, dark], sliders), [neutral, dark], `at ${energy}`)
  }
})

test('the closest title comes first, by every set slider together', () => {
  const cozyDark = title(['Slice of Life', 'Horror'], [tag('Iyashikei', 90), tag('Gore', 90)])
  const cozyLight = title(['Slice of Life', 'Comedy'], [tag('Iyashikei', 90)])
  const hypeDark = title(['Action', 'Horror'], [tag('Gore', 90)])
  const pool = [cozyLight, hypeDark, cozyDark]
  assert.equal(rankMatches(pool, { ...NONE, energy: -2, tone: 2 })[0], cozyDark)
  assert.equal(rankMatches(pool, { ...NONE, energy: -2, tone: -2 })[0], cozyLight)
  assert.equal(rankMatches(pool, { ...NONE, energy: 2, tone: 2 })[0], hypeDark)
})

test('Mushishi at Very cozy is named for Iyashikei and Episodic, its strongest cozy tags', () => {
  const why = whyOf(recorded(MUSHISHI), { ...NONE, energy: -2 })
  assert.deepEqual(why, ['Iyashikei', 'Episodic'])
  assert.ok(why.every((name) => MOOD_MAP.energy.low.tags.includes(name)))
})

test('no recorded title at any of the 125 slider settings is named for a spoiler tag', () => {
  // Spoiler tags count toward the score, but naming one would give the twist away. A name that is
  // a spoiler on the title it is shown for is the leak, whatever it is on other titles.
  const leaks: string[] = []
  let named = 0
  for (const media of RECORDED) {
    const spoilers = new Set(
      media.tags
        .filter((tag) => tag.isGeneralSpoiler || tag.isMediaSpoiler || tag.isAdult)
        .map((tag) => tag.name),
    )
    for (const sliders of SETTINGS)
      for (const name of whyOf(media, sliders)) {
        named++
        if (spoilers.has(name)) leaks.push(`${media.name}: ${name} at ${JSON.stringify(sliders)}`)
      }
  }
  assert.ok(named > 10_000, `only ${named} names given, too few to show anything`)
  assert.deepEqual(leaks.slice(0, 10), [], `${leaks.length} spoiler or adult tags named`)
})

test('Attack on Titan at Very dark names a dark tag, never its spoiler Tragedy', () => {
  // Tragedy (89) is its strongest dark tag after Revenge (93), but a spoiler.
  const why = whyOf(recorded(ATTACK_ON_TITAN), { ...NONE, tone: 2 })
  assert.deepEqual(why, ['Revenge', 'Post-Apocalyptic'])
})

test('with no slider set, there is no Why', () => {
  for (const media of RECORDED) assert.deepEqual(whyOf(media, NONE), [], media.name)
})

test('the Why names the tags that push hardest toward the set sliders, rank by how far', () => {
  const media = title(['Slice of Life', 'Horror'], [tag('Iyashikei', 90), tag('Gore', 60)])
  // Very cozy and Dark: Iyashikei pushes 0.9 x 2, Gore 0.6 x 1.
  assert.deepEqual(whyOf(media, { ...NONE, energy: -2, tone: 1 }), ['Iyashikei', 'Gore'])
  // Cozy and Very dark: Gore pushes 0.6 x 2, more than Iyashikei's 0.9 x 1.
  assert.deepEqual(whyOf(media, { ...NONE, energy: -1, tone: 2 }), ['Gore', 'Iyashikei'])
  // Only toward a set slider's own end: at High-octane, nothing cozy is named.
  assert.deepEqual(whyOf(media, { ...NONE, energy: 2 }), [])
})

test('a tag at the set end of two sliders is named once', () => {
  const media = title([], [tag('Iyashikei', 90), tag('Food', 40)])
  assert.deepEqual(whyOf(media, { ...NONE, energy: -2, tone: -2 }), ['Iyashikei', 'Food'])
})

test('with too few tags, the Why falls back to a genre at a set slider’s end', () => {
  assert.deepEqual(whyOf(title(['Action', 'Drama']), { ...NONE, energy: 2 }), ['Action'])
  assert.deepEqual(
    whyOf(title(['Action', 'Mecha'], [tag('Military', 30)]), { ...NONE, energy: 1 }),
    ['Military', 'Action'],
  )
  assert.deepEqual(
    whyOf(title(['Sci-Fi'], [tag('Tragedy', 90, { isMediaSpoiler: true })]), {
      ...NONE,
      tone: 2,
      complexity: 2,
    }),
    ['Sci-Fi'],
  )
})
