// The words a message or a handle may not hold (D11), for the word filter (word-filter.ts). The
// list is public, here in the code, and never complete: it stops the commonest swearing and slurs,
// typed as they are or with the usual tricks the filter undoes, and nothing cleverer, so it is
// kept short. Each is written in lowercase letters alone, and matches only as a whole word, so
// "class" and "Scunthorpe" pass. A word that is also a title or a name stays out: "bastard" is an
// anime's, and "dick" a name.
export const BLOCKED_WORDS = [
  'ass',
  'asshole',
  'bitch',
  'bullshit',
  'cunt',
  'dickhead',
  'fag',
  'faggot',
  'fuck',
  'fucker',
  'fucking',
  'motherfucker',
  'nigga',
  'nigger',
  'retard',
  'shit',
  'slut',
  'whore',
]
