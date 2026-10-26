import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pullable } from '../mood/roll.ts'
import { samplesFor } from './fallback.ts'
import { hasSmallCover, titleOf } from './format.ts'
import { cardOf, ERAS } from './queries.ts'
import { SAMPLES } from './samples.ts'

// The sample titles a section shows when it can't reach AniList. They ship with the app, so the
// file itself is checked here, whatever scripts/refresh-samples.ts lets through.

test('the samples fill the trending page, each a different title', () => {
  assert.ok(SAMPLES.length >= 9, `only ${SAMPLES.length} samples for the page's 9 panels`)
  const ids = new Set(SAMPLES.map((media) => media.id))
  assert.equal(ids.size, SAMPLES.length, 'a title is in the samples twice')
})

test('no sample is an Ecchi or Hentai title', () => {
  // They are chosen for a class demo, and every section and the pull can show them.
  for (const media of SAMPLES) {
    const flagged = media.genres.filter((genre) => genre === 'Ecchi' || genre === 'Hentai')
    assert.deepEqual(flagged, [], `${titleOf(media)} is ${flagged.join(' and ')}`)
  }
})

test('every sample has a cover color and a year, and no episode left to air', () => {
  for (const media of SAMPLES) {
    // A panel whose cover can't load shows this color instead.
    assert.ok(media.coverImage.color, `${titleOf(media)} has no cover color`)
    // samplesFor places each sample in its era by this year.
    assert.ok(media.seasonYear, `${titleOf(media)} has no year`)
    assert.equal(
      media.nextAiringEpisode,
      null,
      `${titleOf(media)} has an episode countdown, which would go stale`,
    )
  }
})

test('every sample carries its synopsis, and only the tags its card shows, as a list’s titles do', () => {
  // A sample's card opens on what the sample holds, with no request, as a list's title's does.
  // Each famous title has a synopsis to show, and its tags are cut as a list's are, which keeps
  // the file, loaded during an outage, small (see cardOf).
  for (const media of SAMPLES) {
    assert.ok(media.description, `${titleOf(media)} has no synopsis`)
    assert.deepEqual(
      media.tags,
      cardOf(media).tags,
      `${titleOf(media)} has tags the card won't show`,
    )
  }
})

test('the biggest trending panels get sharp pictures', () => {
  // The first three fill the biggest panels and the intro's cover fan, which skips small covers.
  // The first is the splash panel, which shows its banner on wide screens.
  for (const media of SAMPLES.slice(0, 3)) {
    assert.ok(!hasSmallCover(media), `${titleOf(media)} has only a small cover`)
  }
  assert.ok(SAMPLES[0].bannerImage, `${titleOf(SAMPLES[0])}, the splash panel, has no banner`)
})

test('every sample is in exactly one era', () => {
  for (const media of SAMPLES) {
    const eras = ERAS.filter((era) => samplesFor([media], era).length).map((era) => era.label)
    assert.equal(
      eras.length,
      1,
      `${titleOf(media)} (${media.seasonYear}) is in ${eras.join(' and ') || 'no era'}`,
    )
  }
})

test('every era but Upcoming has at least 3 samples, and Upcoming has none', () => {
  for (const era of ERAS) {
    const count = samplesFor(SAMPLES, era).length
    if (era.id === 'upcoming') assert.equal(count, 0, `Upcoming has ${count} samples`)
    else assert.ok(count >= 3, `${era.label} has only ${count} samples`)
  }
})

test('at least 3 of the 9 samples that fill the trending page can come out of the pull machine', () => {
  // With AniList out of reach, the pull draws from the samples on the page: these 9, plus the
  // decade's, of which Upcoming has none. Ecchi titles never come out of it (spec §3G).
  const page = SAMPLES.slice(0, 9)
  assert.ok(pullable(page).length >= 3, `only ${pullable(page).length} samples can be pulled`)
})
