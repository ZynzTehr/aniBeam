import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decodeEntities, parseSynopsis, type Run } from './synopsis.ts'

const saved = JSON.parse(readFileSync(new URL('./saved-details.json', import.meta.url), 'utf8'))
const description = (title: string): string => saved.descriptions[title]

// A synopsis written out to compare: paragraphs as items, lines joined by "\n", _italics_ and
// **bold** marked as in Markdown.
const show = (description: string | null) => {
  const { paragraphs, source } = parseSynopsis(description)
  const line = (runs: Run[]) =>
    runs.map((run) => (run.strong ? `**${run.text}**` : run.em ? `_${run.text}_` : run.text))
  return {
    paragraphs: paragraphs.map((lines) => lines.map((runs) => line(runs).join('')).join('\n')),
    source,
  }
}

test("parseSynopsis splits off the closing source line as a caption (Frieren's real one)", () => {
  const { paragraphs, source } = show(description('Frieren'))
  assert.equal(source, 'Crunchyroll')
  assert.equal(paragraphs.length, 1)
  assert.match(paragraphs[0], /^The adventure is over but life goes on .* a new adventure…$/)
})

test('parseSynopsis makes paragraphs of <br><br>, whatever line endings come with it', () => {
  // Attack on Titan's breaks come with \r\n, Heavy Object's are <br></br>.
  const titan = show(description('Attack on Titan'))
  assert.equal(titan.source, 'MangaHelpers')
  assert.deepEqual(
    titan.paragraphs.map((paragraph) => paragraph.slice(0, 30)),
    ['Several hundred years ago, hum', 'Flash forward to the present a'],
  )
  assert.ok(titan.paragraphs.every((paragraph) => !/[\r\n]|  /.test(paragraph)))
  const heavy = show(description('Heavy Object'))
  assert.equal(heavy.source, null)
  assert.deepEqual(
    heavy.paragraphs.map((paragraph) => paragraph.slice(0, 20)),
    ['In the distant futur', 'Qwenthur Barbotage, ', 'Heavy Object follows'],
  )
  assert.match(heavy.paragraphs[0], /"Objects"—massive/)
})

test("parseSynopsis keeps One Piece's bold heading and its list a line each", () => {
  const { paragraphs, source } = show(description('One Piece'))
  assert.equal(source, null)
  assert.equal(paragraphs.length, 3)
  assert.match(paragraphs[1], /^Enter Monkey D\. Luffy, .* Luffy’s reason /)
  assert.deepEqual(paragraphs[2].split('\n'), [
    '***This includes the following special episodes:**', // the first * is AniList's
    '- Chopperman to the Rescue! Protect the TV Station by the Shore! (Episode 336)',
    "- The Strongest Tag-Team! Luffy and Toriko's Hard Struggle! (Episode 492)",
    '- Team Formation! Save Chopper (Episode 542)',
    "- History's Strongest Collaboration vs. Glutton of the Sea (Episode 590)",
    '- 20th Anniversary! Special Romance Dawn (Episode 907)',
  ])
})

test('parseSynopsis takes a source line out of the middle, and ends an open <i> with the text', () => {
  // Code Geass: Akito's note follows its source line, and its <i> is never closed.
  const { paragraphs, source } = show(description('Code Geass: Akito the Exiled 1'))
  assert.equal(source, 'MAL Rewrite')
  assert.equal(paragraphs.length, 3)
  assert.equal(
    paragraphs[2],
    '_Note: The film received a special pre-screening on July 16, 2012 at theatres in Shinjuku Ward 9 and Ikebukuro Cinema Sunshine._',
  )
})

test("parseSynopsis credits the synopsis's own source, not its note's (NARUTO×NINKU's real one)", () => {
  // AniList puts a synopsis's source right after it, before any note, and here the note has a
  // source of its own: the first source line is the caption, and the note's stays with the note.
  // The note's <i> holds another <i>, which closes only itself, so the note is italic throughout.
  const { paragraphs, source } = show(description('NARUTO×NINKU'))
  assert.equal(source, 'NARUTO x NINKŪ Official Site')
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.slice(0, 30)),
    [
      '_"I\'m heading out on a mission',
      'Team 7 members Naruto, Sasuke,',
      'What appears before the bewild',
      '_Note: The official website fo',
      '(Source: Anime News Network, e',
    ],
  )
  assert.match(paragraphs[3], /^_Note: [^_]* 20th anniversary back in 2022\._$/)
})

test('parseSynopsis takes a closing "[Written by …]" as the source too (Princess Mononoke\'s)', () => {
  const { paragraphs, source } = show(description('Princess Mononoke'))
  assert.equal(source, 'MAL Rewrite')
  assert.equal(paragraphs.length, 4)
  assert.match(paragraphs[3], /expel his curse\?$/)
})

test('parseSynopsis takes a source only from a paragraph of its own, whole', () => {
  // A source line sharing its paragraph, or words that only mention one, stay in the synopsis:
  // before them, after them, or around them, so the pattern holds to the paragraph's start and
  // its end alike.
  assert.deepEqual(show('Story.<br><br>(Source: Crunchyroll)<br>Note: aired in 2 parts.'), {
    paragraphs: ['Story.', '(Source: Crunchyroll)\nNote: aired in 2 parts.'],
    source: null,
  })
  for (const text of [
    'He quotes (Source: none) and walks off.',
    '(Source: none) opens this.',
    'And so it ends (Source: none)',
    'Read it [Written by Ann] today.',
    '[Written by Ann] and more',
    'As retold [Written by Ann]',
  ])
    assert.deepEqual(show(text), { paragraphs: [text], source: null }, text)
})

test("parseSynopsis shows the Latin-1 letters AniList writes as entities (Nausicaä's, Heidi's)", () => {
  const nausicaa = show(description('Nausicaä of the Valley of the Wind'))
  assert.equal(nausicaa.source, 'Disney')
  assert.match(nausicaa.paragraphs[0], /Princess Nausicaä, the people .* Nausicaä and her brave/)
  assert.doesNotMatch(nausicaa.paragraphs[0], /&/)
  const heidi = show(description('Heidi, Girl of the Alps'))
  assert.equal(heidi.source, 'Anime News Network, edited')
  assert.match(heidi.paragraphs[0], /her grandfather Öhi, who lives in the Alps/)
})

test("parseSynopsis drops a link and keeps its words (Haruhi's note)", () => {
  const { paragraphs, source } = show(description('The Melancholy of Haruhi Suzumiya'))
  assert.equal(source, null)
  assert.equal(
    paragraphs.at(-1),
    '_Note: This entry is for the original 14-episode 2006 airing. The series was further expanded and reordered into a 28-episode series in 2009._',
  )
})

test('parseSynopsis has nothing to show for no description', () => {
  for (const nothing of [null, undefined, '', '  \n', '<br><br>\n<br>']) {
    assert.deepEqual(parseSynopsis(nothing), { paragraphs: [], source: null })
  }
  assert.deepEqual(parseSynopsis('(Source: Crunchyroll)'), {
    paragraphs: [],
    source: 'Crunchyroll',
  })
  assert.deepEqual(parseSynopsis('[Written by MAL Rewrite]'), {
    paragraphs: [],
    source: 'MAL Rewrite',
  })
})

test('parseSynopsis spaces words and styles as a browser would', () => {
  assert.deepEqual(show('The third season of <i>Shangri-La Frontier</i>.').paragraphs, [
    'The third season of _Shangri-La Frontier_.',
  ])
  assert.deepEqual(show('<i>Toradora!</i> <b>is</b>   a  <i>romantic</i>\ncomedy').paragraphs, [
    '_Toradora!_ **is** a _romantic_ comedy',
  ])
  assert.deepEqual(show('one <br>  two<br><b>three</b> <br>\n<br>  four').paragraphs, [
    'one\ntwo\n**three**',
    'four',
  ])
})

// Whatever a description holds, it comes out as text in runs that carry nothing else, and React
// escapes text. These would run script, or style the page, if they reached it as HTML.
test('parseSynopsis turns hostile markup into plain text', () => {
  const cases: [string, string][] = [
    ['<script>alert(1)</script>Hello', 'alert(1)Hello'],
    ['<img src=x onerror="alert(1)">Hi', 'Hi'],
    ['<a href="javascript:alert(1)">click me</a>', 'click me'],
    ['<i onclick="alert(1)" style="color:red">styled</i>', '_styled_'],
    ['<scr<script>ipt>alert(1)</scr</script>ipt>', '<script>alert(1)</script>'],
    ['<svg><style>*{display:none}</style></svg>', '*{display:none}'],
    ['a < b and c > d', 'a < b and c > d'],
    ['<!-- note -->kept', '<!-- note -->kept'],
  ]
  for (const [hostile, text] of cases) {
    const { paragraphs, source } = parseSynopsis(hostile)
    assert.deepEqual(show(hostile).paragraphs, [text], hostile)
    assert.equal(source, null)
    for (const run of paragraphs.flat(2))
      assert.deepEqual(Object.keys(run), ['text', 'em', 'strong'])
  }
})

test('parseSynopsis lets no open tag run past its paragraph, ignores a stray close, and closes a tag inside its like only once', () => {
  assert.deepEqual(show('<i>open<br><br>next <b>bold<br><br>plain').paragraphs, [
    '_open_',
    'next **bold**',
    'plain',
  ])
  // As in HTML, a tag opened inside one of its kind closes only itself.
  assert.deepEqual(show('</b>stray</i> close <b><b>twice</b> once</b> done').paragraphs, [
    'stray close **twice once** done',
  ])
  assert.deepEqual(show('<i>the <em>Show</em> aired</i> then').paragraphs, [
    '_the Show aired_ then',
  ])
})

test('parseSynopsis shows entities that decode to markup as the characters, never as tags', () => {
  assert.deepEqual(show('&lt;script&gt;alert(1)&lt;/script&gt;').paragraphs, [
    '<script>alert(1)</script>',
  ])
  assert.deepEqual(show('&#60;i&#62;not italic&#x3C;br&#x3e;one line').paragraphs, [
    '<i>not italic<br>one line',
  ])
  assert.deepEqual(show('&amp;lt;b&amp;gt; is decoded once').paragraphs, [
    '&lt;b&gt; is decoded once',
  ])
})

test("decodeEntities decodes AniList's entities and leaves unknown or impossible ones be", () => {
  // From the saved titles: Soul Eater, Paranoia Agent, Wolf Children and others.
  assert.equal(decodeEntities('Maka &amp; Soul'), 'Maka & Soul')
  assert.equal(decodeEntities('he&rsquo;s'), 'he’s')
  assert.equal(decodeEntities('children&mdash;an'), 'children—an')
  assert.equal(decodeEntities('Machina &ndash; The'), 'Machina – The')
  assert.equal(decodeEntities('&quot;&apos;&nbsp;&hellip;&#8220;&#x201D;'), '"\' …“”')
  // HTML's Latin-1 letters and signs, and its typographic ones, by name.
  assert.equal(
    decodeEntities(
      '&auml;&Ouml;&uuml;&Uuml;&eacute;&Egrave;&agrave;&ccedil;&szlig;&ntilde;&oslash;&aring;&AElig;',
    ),
    'äÖüÜéÈàçßñøåÆ',
  )
  assert.equal(
    decodeEntities(
      '&iexcl;&pound;&yen;&copy;&reg;&deg;&plusmn;&sup2;&frac12;&times;&divide;&laquo;&raquo;&middot;&yuml;',
    ),
    '¡£¥©®°±²½×÷«»·ÿ',
  )
  assert.equal(
    decodeEntities(
      '&euro;&trade;&bull;&dagger;&permil;&sbquo;&bdquo;&lsaquo;&rsaquo;&OElig;&scaron;&Yuml;',
    ),
    '€™•†‰‚„‹›ŒšŸ',
  )
  for (const kept of [
    '&constructor;',
    '&toString;',
    '&AMP;',
    '&bogus;',
    '&#0;',
    '&#99999999999;',
    '&#x110000;',
    '& amp;',
  ]) {
    assert.equal(decodeEntities(kept), kept)
  }
})
