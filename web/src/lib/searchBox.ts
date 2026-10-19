// The header's search box on a phone, a textarea that wraps what is typed and grows a row at a
// time (see SiteHeader's SearchBubble).

/** What the box holds once any pasted line break is a space: a search is one line, wrapped. */
export const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ')

/**
 * How much of what is typed the box shows, given its wrapped height and the height of a row (20px
 * on a phone, more where a reader widens text spacing): up to three rows. `over` says it takes
 * more, so the box scrolls, a whole row at a time.
 */
export const rowsShown = (height: number, row: number) => ({
  height: Math.min(height, 3 * row),
  over: height > 3 * row,
})
