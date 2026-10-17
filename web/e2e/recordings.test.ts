import assert from 'node:assert/strict'
import { test } from 'node:test'
import { titleOf } from '../src/features/anime/format.ts'
import type { Media } from '../src/features/anime/queries.ts'
import { SAMPLES } from '../src/features/anime/samples.ts'
import { compare, JUDGED, problems, recordings, requests } from './recordings.ts'

// A recorded browser answers the page only from a recording made for the exact request it sends
// (see Browser.open), so a recording that is missing, or was made for an older query, fails the
// check that needed it, by name, but only once Chrome runs it. Here, each is named offline, and so
// is a recording no check asks for any more.
test('every request the browser checks send AniList has a recording made for it, and no other is kept', async () => {
  assert.deepEqual(
    compare(await requests(), recordings()),
    { missing: [], stale: [], unused: [] },
    'run `npm run e2e:record` in web/: it records the missing and stale ones and deletes the unused',
  )
})

// A recording made for today's request can still lack what a check relies on AniList's titles for:
// nine to trend, Frieren first for "frieren", none for "zzqqxx" (see problems()). A check run on
// it would fail, or worse, pass without testing what it says. The recorder writes none like that,
// so here it is one edited by hand, or a rule that has changed since it was recorded.
test('every recording holds what the checks that use it rely on AniList’s titles for', async () => {
  // A rule for a recording no check asks for would judge nothing, so this could never fail on it.
  const wanted = (await requests()).map(({ name }) => name)
  assert.deepEqual(
    JUDGED.filter((name) => !wanted.includes(name)),
    [],
    'rules in problems() for recordings no check asks for, which they never judge',
  )
  assert.deepEqual(
    problems(recordings()),
    [],
    'record them again with `npm run e2e:record -- <names>` in web/; if AniList’s answers can’t hold it any more, the check that relies on it must change, and so must its rule',
  )
})

// Both checks above pass on today's recordings, which hold all they should, so they can't tell a
// guard that works from one that finds nothing: compare() never calling a recording stale, say,
// or a rule that never fires, would pass them too. So each guard is also tried on recordings
// broken in the ways it must catch.

// A recording goes stale when the app changes the request it answers, in its query or its
// variables, and so does a file that isn't a whole recording, such as one edited by hand. Here each
// request starts with a whole recording made for it, so that only what is broken below is wrong,
// whatever the files in anilist/ hold.
test('a recording taken away is missing, one made for another query or other variables, or not whole, is stale, and one no check asks for is unused', async () => {
  const wanted = await requests()
  const kept = new Map<string, any>(
    wanted.map(({ name, request }) => [
      name,
      { request: structuredClone(request), status: 200, body: {} },
    ]),
  )
  const recordingOf = (name: string) =>
    kept.get(name) ?? assert.fail(`no check asks for ${name} any more, so break another here`)
  // As if recorded before the app asked for banners, and while the 1990s had other dates.
  const trending = recordingOf('trending')
  trending.request.query = trending.request.query.replace(' bannerImage', '')
  recordingOf('first-visit').request.variables.to -= 1
  delete recordingOf('search-mushi').status
  delete recordingOf('search-dragon').body
  // A search renamed since it was recorded: its recording is kept under the old name.
  kept.set('search-old-term', recordingOf('search-nar'))
  kept.delete('search-nar')
  assert.deepEqual(compare(wanted, kept), {
    missing: ['search-nar'],
    stale: ['first-visit', 'trending', 'search-mushi', 'search-dragon'],
    unused: ['search-old-term'],
  })
})

const saved = recordings()
/** A recording, as a fresh copy, so a test can break it where it is. */
function recorded(name: string) {
  const recording = saved.get(name)
  if (!recording) throw new Error(`web/e2e/anilist/ has no ${name}.json`)
  return structuredClone(recording)
}
/**
 * Fails unless problems(), once `change` has broken a copy of `name`, names it in one line that
 * starts as `starts` and ends saying `says`, and finds nothing else that today's recordings don't
 * give it: so a recording broken by hand fails the check of today's recordings, not these too.
 */
function namedOnce(name: string, change: (recording: any) => void, starts: string, says: string) {
  const recording = recorded(name)
  change(recording)
  const today = problems(saved)
  const found = problems(new Map(saved).set(name, recording))
  const named = found.filter(
    (line) => line.startsWith(`${starts}, `) && line.endsWith(`; ${says}.`),
  )
  const added = found.filter((line) => !today.includes(line))
  assert.ok(
    named.length === 1 && added.every((line) => named.includes(line)),
    `not named once, as "${starts}, …; ${says}."; found, beyond today's: ${JSON.stringify(added)}`,
  )
}

// A recording must be a 200 with no errors and a list of titles for each list asked for. One that
// isn't is named once, saying what AniList answered, and not again by each rule its titles would
// break: [what AniList answered, the recording made into it, its status, what its answer becomes,
// and how the line ends].
const notTitles: [string, string, number, (body: any) => unknown, string][] = [
  [
    'a 429',
    'trending',
    429,
    () => ({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }),
    'AniList answered 429 with errors: [{"message":"Too Many Requests.","status":429}]',
  ],
  [
    // The recorder keeps an answer it can't read as JSON, such as a page refusing it, as null.
    'a 403 that isn’t JSON',
    'search-mushishi-zoku',
    403,
    () => null,
    'AniList answered 403',
  ],
  [
    'a 200 with errors beside its titles',
    'search-dragon-ball',
    200,
    (body) => ({ ...body, errors: [{ message: 'Internal Server Error', status: 500 }] }),
    'AniList answered 200 with errors: [{"message":"Internal Server Error","status":500}]',
  ],
  [
    'a 200 with data.Page null',
    'search-mushi',
    200,
    () => ({ data: { Page: null } }),
    'AniList answered 200 with no list of titles',
  ],
  [
    'a 200 with no data',
    'search-nar',
    200,
    () => ({ data: null }),
    'AniList answered 200 with no list of titles',
  ],
  [
    // AniList's answer for an id with no anime, or an adult title.
    'a 404 for a title',
    'title-154587',
    404,
    () => ({ data: { Media: null }, errors: [{ message: 'Not Found.', status: 404 }] }),
    'AniList answered 404 with errors: [{"message":"Not Found.","status":404}]',
  ],
  [
    'a 200 with data.Media null',
    'title-154587',
    200,
    () => ({ data: { Media: null } }),
    'AniList answered 200 with no list of titles',
  ],
]
for (const [what, name, status, answer, says] of notTitles)
  test(`a recording that isn’t a 200 with titles is named once, with what AniList answered: ${what}`, () =>
    namedOnce(
      name,
      (recording) => Object.assign(recording, { status, body: answer(recording.body) }),
      `${name} needs to be a 200 with no errors and a list of titles for each list asked for (or the title asked for)`,
      says,
    ))

/** A title with its cover made big or small, as hasSmallCover() in format.ts tells them apart. */
const cover = (media: Media, file: 'large' | 'medium'): Media => ({
  ...media,
  coverImage: {
    ...media.coverImage,
    extraLarge: media.coverImage.extraLarge.replace(/\/cover\/\w+\//, `/cover/${file}/`),
  },
})
/** The 1990s' first title, as a first visit has it. */
const ninetiesFirst = (): Media => recorded('first-visit').body.data.era.media[0]

// What a check relies on AniList's titles for (see RULES in recordings.ts), broken one rule at a
// time, in one list of a copy of a recording: [what is broken, the list (its recording, and its
// name in the answer), what its titles become, how the line naming it starts, and how it ends].
// Lists that the same rules judge, such as trending alone and in a first visit, take turns.
const lacking: [string, [string, string], (titles: Media[]) => Media[], string, string][] = [
  [
    'trending with 8 titles',
    ['trending', 'Page'],
    (titles) => titles.slice(0, 8),
    'trending needs at least 9 titles',
    'it has 8',
  ],
  [
    'the first visit’s trending all Ecchi',
    ['first-visit', 'trending'],
    (titles) => titles.map((media) => ({ ...media, genres: [...media.genres, 'Ecchi'] })),
    "first-visit's trending needs a title that isn't Ecchi",
    'none is',
  ],
  [
    'trending with 3 big covers',
    ['trending', 'Page'],
    (titles) => titles.map((media, i) => cover(media, i < 3 ? 'large' : 'medium')),
    'trending needs at least 4 big covers',
    'it has 3',
  ],
  [
    'the first visit’s trending opening on the samples’ first nine',
    ['first-visit', 'trending'],
    (titles) => titles.map((media, i) => (i < 9 ? { ...media, title: SAMPLES[i].title } : media)),
    "first-visit's trending needs a first nine unlike the samples' first nine",
    "its first nine are the samples'",
  ],
  [
    'the 1990s with 14 titles',
    ['era-1990s', 'Page'],
    (titles) => titles.slice(0, 14),
    'era-1990s needs at least 15 titles',
    'it has 14',
  ],
  [
    'the first visit’s 1990s with a small second cover',
    ['first-visit', 'era'],
    (titles) => titles.map((media, i) => (i === 1 ? cover(media, 'medium') : media)),
    "first-visit's era needs big covers on its first 2 titles",
    'it has 1',
  ],
  [
    'the 1980s with 14 titles',
    ['era-1980s', 'Page'],
    (titles) => titles.slice(0, 14),
    'era-1980s needs at least 15 titles',
    'it has 14',
  ],
  [
    'the 1980s opening on the 1990s’ first title, ONE PIECE',
    ['era-1980s', 'Page'],
    (titles) => [ninetiesFirst(), ...titles.slice(1)],
    "era-1980s needs a first title other than the 1990s' first",
    "it opens on 'ONE PIECE', as first-visit's era does",
  ],
  [
    'frieren opening on a title that doesn’t name Frieren',
    ['search-frieren', 'Page'],
    ([first, ...rest]) => [
      { ...first, title: { ...first.title, english: 'Beyond Journey’s End' } },
      ...rest,
    ],
    'search-frieren needs a first title naming Frieren',
    "it opens on 'Beyond Journey’s End'",
  ],
  [
    'frieren with 12 titles',
    ['search-frieren', 'Page'],
    (titles) => Array.from({ length: 12 }, (_, i) => titles[i % titles.length]),
    'search-frieren needs fewer than 12 titles',
    'it has 12',
  ],
  [
    'mushishi finding the samples’ first 12 titles, none of them MUSHI-SHI',
    ['search-mushishi', 'Page'],
    () => SAMPLES.slice(0, 12),
    'search-mushishi needs a title naming MUSHI-SHI',
    'none does',
  ],
  [
    'naruto with 11 titles',
    ['search-naruto', 'Page'],
    (titles) => titles.slice(0, 11),
    'search-naruto needs at least 12 titles',
    'it has 11',
  ],
  [
    'naruto finding the samples’ first 12 titles, none of them Naruto',
    ['search-naruto', 'Page'],
    () => SAMPLES.slice(0, 12),
    'search-naruto needs a title naming Naruto',
    'none does',
  ],
  [
    'zzqqxxnotananime with a title',
    ['search-zzqqxxnotananime', 'Page'],
    () => [ninetiesFirst()],
    'search-zzqqxxnotananime needs no titles',
    'it has 1',
  ],
  [
    'zzqqxxy with a title',
    ['search-zzqqxxy', 'Page'],
    () => [ninetiesFirst()],
    'search-zzqqxxy needs no titles',
    'it has 1',
  ],
  [
    'one piece with no titles',
    ['search-one-piece', 'Page'],
    () => [],
    'search-one-piece needs a title',
    'it has none',
  ],
  [
    'Frieren’s address answered with another title',
    ['title-154587', 'Media'],
    () => [ninetiesFirst()],
    "title-154587's Media needs a title naming Frieren",
    `it is '${titleOf(ninetiesFirst())}'`,
  ],
]
for (const [what, [name, list], change, starts, says] of lacking)
  test(`a recording that lacks what a check relies on is named, with the rule it breaks: ${what}`, () =>
    namedOnce(
      name,
      ({ body }) =>
        // A title asked for on its own is the answer's data.Media itself, not a list.
        list === 'Media'
          ? (body.data.Media = change([body.data.Media])[0])
          : (body.data[list].media = change(body.data[list].media)),
      starts,
      says,
    ))

// The check of today's recordings holds JUDGED to the requests the checks send, so that no rule
// judges a recording none of them asks for. But JUDGED is worked out from the rules, and worked out
// wrong, as nothing, say, it would leave that check nothing to hold: a rule for a search renamed
// since would judge nothing, unseen. So it is held to the list written out here as well.
test('JUDGED holds every recording a rule judges, and no other', () => {
  assert.deepEqual(
    [...JUDGED].sort(),
    [
      'era-1980s',
      'era-1990s',
      'first-visit',
      'search-frieren',
      'search-mushishi',
      'search-naruto',
      'search-one-piece',
      'search-zzqqxx',
      'search-zzqqxxnotananime',
      'search-zzqqxxy',
      'title-154587',
      'trending',
    ],
    'JUDGED isn’t the recordings RULES in recordings.ts judge; a rule for another recording adds it here',
  )
})

// requests() stands in for fetch while the app's code builds each request (see sent() in
// recordings.ts), and the recorder asks AniList with fetch straight after: a stand-in left in
// place would answer it instead, with no titles.
test('building the requests the checks send leaves fetch as it found it', async () => {
  const fetch = globalThis.fetch
  try {
    await requests()
    assert.equal(globalThis.fetch, fetch, 'requests() left its stand-in for fetch in place')
  } finally {
    globalThis.fetch = fetch
  }
})
