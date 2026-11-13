// The word filter (D11): whether a message's body or a handle holds a word of BLOCKED_WORDS
// (blocked-words.ts). A message with one is refused with message-blocked, and a handle with one
// with handle-blocked, rather than posted with the word masked. Only whole words match, so the
// words inside "Scunthorpe", "class" and "assassin" never count. The text is first read as a
// reader would see it, undoing the usual tricks:
// - NFKC, so letters Unicode counts as the same, such as full-width ｆｕｃｋ, become plain ones;
// - lowercase;
// - accents dropped: NFD splits ü into u and its accent, and the accent goes, so fück is fuck;
// - characters that show nothing, such as a zero-width space, dropped, so they can't split a word;
// - leetspeak read as letters: 0 o, 1 i or l, 3 e, 4 a, 5 s, @ a and $ s, so sh1t is shit,
//   but only in a word with as many letters as digits or more, so that a number such as
//   episode 455, 45s or the phone A55 stays a number;
// - then it is split into words at anything that is not a letter;
// - and a letter repeated counts once, so fuuuuck is fuck. A listed word's own repeats must
//   still be there, as many or more: "ass" matches asssss but not "as", and the slur with gg
//   not "Niger".
// The text is read with 1 as l too, so that s1ut is caught as well as sh1t, and a third time with
// its digits as gaps, not letters, so that fuck1 or Shit_99, as handles are often written, is.
import { BLOCKED_WORDS } from './blocked-words.ts'

/** Leetspeak's stand-ins for letters, with 1 as i. */
const LEET: Record<string, string> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', '@': 'a', $: 's' }
/** The readings of a text: leetspeak with 1 as i, then as l, and digits as gaps (none). */
const READINGS = [LEET, { ...LEET, 1: 'l' }, undefined]

/** A word's letters as runs of one letter, each [letter, how many times]: ass is a 1, s 2. */
type Runs = [string, number][]

function runs(word: string) {
  const out: Runs = []
  for (const letter of word) {
    const last = out.at(-1)
    if (last?.[0] === letter) last[1]++
    else out.push([letter, 1])
  }
  return out
}

/** The word with each run as one letter: fuuuck is fuck, and ass is as. */
const collapsed = (word: Runs) => word.map(([letter]) => letter).join('')

/** The listed words' runs, by their collapsed form. */
const LISTED = new Map<string, Runs[]>()
for (const word of BLOCKED_WORDS) {
  const listed = runs(word)
  const key = collapsed(listed)
  LISTED.set(key, [...(LISTED.get(key) ?? []), listed])
}

/** Whether `token` has as many letters as digits, or more: a word, not a number. */
function wordy(token: string) {
  const count = (kind: RegExp) => token.match(kind)?.length ?? 0
  return count(/\p{L}/gu) >= count(/\p{N}/gu)
}

/** The words of `text` as the filter reads them, with `leet`'s stand-ins as letters if given. */
function words(text: string, leet: Record<string, string> | undefined) {
  const read = text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
  // With leetspeak, each run of letters, digits and stand-ins is read on its own first, and its
  // stand-ins become letters only if it is wordy.
  const tokens = leet
    ? read
        .split(/[^\p{L}\p{N}@$]+/u)
        .map((token) =>
          wordy(token) ? token.replace(/[01345@$]/g, (stand) => leet[stand]) : token,
        )
    : [read]
  return tokens.flatMap((token) => token.split(/\P{L}+/u)).filter((word) => word !== '')
}

/** Whether `text` holds a listed word, as a whole word. */
export function hasBlockedWord(text: string) {
  for (const leet of READINGS)
    for (const word of words(text, leet)) {
      const found = runs(word)
      // The same letters in the same runs, each run of the text's as long as the listed word's
      // or longer.
      const listed = LISTED.get(collapsed(found)) ?? []
      if (listed.some((runs) => runs.every(([, times], i) => found[i][1] >= times))) return true
    }
  return false
}
