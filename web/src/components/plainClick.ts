import type { MouseEvent } from 'react'

/**
 * A click the page may handle itself: the main button with no key held. Ctrl or Cmd (a new tab),
 * Shift (a new window), Alt (a download) and other buttons belong to the browser.
 */
export const isPlainClick = (
  event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
