import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BLOCKED_WORDS } from './blocked-words.ts'
import { hasBlockedWord } from './word-filter.ts'

// The word filter, on listed words in the forms people type them, and on words and names that
// hold a listed word inside them, which must pass.

/** The texts of `texts` the filter lets through, which should be none. */
const passed = (texts: string[]) => texts.filter((text) => !hasBlockedWord(text))
/** The texts of `texts` the filter refuses, which should be none. */
const refused = (texts: string[]) => texts.filter((text) => hasBlockedWord(text))

test('every listed word is refused, in any case', () => {
  assert.ok(BLOCKED_WORDS.length >= 10 && BLOCKED_WORDS.length <= 20, 'the list is kept short')
  assert.deepEqual(passed(BLOCKED_WORDS), [])
  assert.deepEqual(passed(BLOCKED_WORDS.map((word) => word.toUpperCase())), [])
  assert.deepEqual(passed(['Shit', 'fUcK']), [])
})

test('leetspeak, stretched, accented and full-width forms are refused', () => {
  assert.deepEqual(
    passed([
      // Leetspeak: 0 o, 1 i or l, 3 e, 4 a, 5 s, @ a, $ s.
      'sh1t',
      'b1tch',
      'wh0re',
      '@ss',
      'a$$',
      '4ss',
      '@$$',
      '5h1t',
      'r3tard',
      // 1 stands for l as often as for i.
      's1ut',
      'assho1e',
      'a55ho1e',
      // Letters repeated.
      'fuuuuck',
      'FFFUUUCCCKKK',
      'shiiiiit',
      'asssss',
      // Accents, as one code point or as a letter and its accent.
      'fück',
      'shït',
      'fück',
      // Full-width, and other letters Unicode counts as plain ones.
      'ｆｕｃｋ',
      'ＳＨＩＴ',
      '𝐟𝐮𝐜𝐤',
      // All at once.
      'ｓｈ１１１ｉｉｔ',
      '$hïïït',
      // Characters that show nothing, inside the word.
      'fu​ck',
      'sh­it',
      // Hangul fillers, which show nothing but Unicode counts as letters.
      'fu\u3164ck',
      'sh\uffa0it',
      'fu\u115fck',
      'fu\u1160ck',
    ]),
    [],
  )
})

test('a listed word inside a sentence, or with punctuation around it, is refused', () => {
  assert.deepEqual(
    passed([
      'that episode was shit',
      'What the fuck?!',
      '"Fuck."',
      '(shit)',
      'oh...shit...',
      "shit's real",
      'that ending, sh1t!!!',
      'no way-fuuuck-no way',
      'he is a total @$$hole',
      '#shit',
      'shit_post',
      'fuck1',
      'Shit_99',
    ]),
    [],
  )
})

test('words and names that hold a listed word inside them pass, as do ones that are close', () => {
  assert.deepEqual(
    refused([
      'Scunthorpe',
      'class',
      'classic',
      'assassin',
      'Assassination Classroom',
      'cocktail',
      'therapist',
      'grape',
      'pass',
      'glass',
      'bass',
      'embassy',
      'Cassandra',
      'Matsushita',
      'Shitara',
      'Hancock',
      'Dickens',
      'Sussex',
      'shuttlecock',
      'Bastard!! Heavy Metal, Dark Fantasy',
      'titular',
      // Close to a listed word, with a letter fewer: as for ass, Niger for the slur.
      'as',
      'As you wish',
      'Niger',
      'fagot',
      // A word made of letters, digits and stand-ins that reads as no listed word either way.
      'l33t',
      'B4ss',
      'Mob Psycho 100',
      'Re:Zero',
      'K-On!',
      '',
    ]),
    [],
  )
})

test('numbers are not read as leetspeak: episodes, times, prices and model names pass', () => {
  assert.deepEqual(
    refused([
      'One Piece episode 455 was great',
      'Detective Conan ep 455',
      'room 455',
      'wait 45s',
      'skip to 1:45s',
      'it costs 45$',
      "it's 245$ on the store",
      'I scored 2455 points',
      'my id is 84557',
      '4552',
      'watching on my Galaxy A55',
      'neo_455',
      'Kai_45s',
      'A55_fan',
    ]),
    [],
  )
  const numbers = Array.from({ length: 100_000 }, (_, number) => String(number))
  assert.deepEqual(refused(numbers), [])
})
