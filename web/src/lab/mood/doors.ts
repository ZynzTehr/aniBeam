// What the lab adds to parts it can't change: a link put into a line of text, the menu's katakana,
// and the Tab stops it counts. Each finds what it needs on the page as drawn.

/**
 * Puts a link to `href` in place of `phrase` in the text of the first element `selector` finds,
 * once: the element keeps its text before the phrase, and the link says `words`. It changes the
 * page's own copy, which React leaves alone while that text stays the same.
 */
export function linkify(selector: string, phrase: string, words: string, href: string) {
  const element = document.querySelector(selector)
  if (!element || element.querySelector('a.ab-lab-door')) return
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    const at = text.indexOf(phrase)
    if (at === -1) continue
    node.nodeValue = text.slice(0, at)
    const link = document.createElement('a')
    link.className = 'ab-lab-door'
    link.href = href
    link.textContent = words
    const rest = document.createTextNode(text.slice(at + phrase.length))
    node.parentNode?.insertBefore(rest, node.nextSibling)
    node.parentNode?.insertBefore(link, rest)
    return
  }
}

/** Sets the katakana beside the menu's link to `href`, which the site's menu has none for. */
export function menuKana(href: string, kana: string) {
  const mark = document.querySelector(`dialog nav a[href="${href}"] > span[aria-hidden="true"]`)
  if (mark && !mark.textContent) mark.textContent = kana
}

/** Focusable elements in `root`: what a Tab walk would stop at. */
export function tabStops(root: Element | null) {
  if (!root) return 0
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[inert], [aria-hidden="true"], fieldset:disabled') &&
      getComputedStyle(element).visibility !== 'hidden',
  ).length
}

/** Puts `to` in place of the text of the first element `selector` finds that reads `from`. */
export function retext(selector: string, from: string, to: string) {
  for (const element of document.querySelectorAll(selector)) {
    if ((element.textContent ?? '').replace(/\s+/g, ' ').trim() !== from) continue
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Node[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node)
    nodes.forEach((node, i) => (node.nodeValue = i === 0 ? to : ''))
    return
  }
}
