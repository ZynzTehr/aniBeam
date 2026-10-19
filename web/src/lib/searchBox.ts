// The header's search box on a phone, a textarea that wraps what is typed and grows a row at a
// time (see SiteHeader's SearchBubble).

/** What the box holds once any pasted line break is a space: a search is one line, wrapped. */
export const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ')

/**
 * Where the caret goes once oneLine has made spaces of the line breaks in `text`, from where it
 * was (`caret`): after the same text, so a paste in the middle leaves it after what was pasted.
 */
export const oneLineCaret = (text: string, caret: number) => oneLine(text.slice(0, caret)).length

/**
 * How much of what is typed the box shows, given its wrapped height and the height of a row (20px
 * on a phone, more where a reader widens text spacing): up to three rows. `over` says it takes
 * more, so the box scrolls, a whole row at a time.
 */
export const rowsShown = (height: number, row: number) => ({
  height: Math.min(height, 3 * row),
  over: height > 3 * row,
})

/**
 * A touch screen's keyboard, as the search box can tell it from the screen the page shows while
 * the box has focus: its width and its tallest height since focus came or the width changed, at
 * the page's own scale (so a pinch zoom is no keyboard), and whether a keyboard has since taken
 * at least a quarter of that height.
 */
export type Keyboard = { width: number; tallest: number; up: boolean }

/** The keyboard as focus comes into the box, which the keyboard follows. */
export const keyboardAt = ({ width, height }: { width: number; height: number }): Keyboard => ({
  width,
  tallest: height,
  up: false,
})

/**
 * The keyboard once the screen the page shows is `width` by `height`. `away` says it went away
 * after coming up: the screen gave back all but a tenth of its height. Android's Back puts the
 * keyboard away and leaves focus in the box, where the Search key, and iOS, take it out. A turn
 * of the phone starts again, as its tallest is another height.
 */
export function keyboardAfter(
  keyboard: Keyboard,
  { width, height }: { width: number; height: number },
): Keyboard & { away: boolean } {
  if (width !== keyboard.width) return { ...keyboardAt({ width, height }), away: false }
  if (height < keyboard.tallest * 0.75) return { ...keyboard, up: true, away: false }
  if (keyboard.up && height >= keyboard.tallest * 0.9)
    return { width, tallest: Math.max(keyboard.tallest, height), up: false, away: true }
  // Coming up a little at a time, or a browser's toolbar showing or hiding.
  const tallest = keyboard.up ? keyboard.tallest : Math.max(keyboard.tallest, height)
  return { width, tallest, up: keyboard.up, away: false }
}
