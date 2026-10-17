import type { MouseEvent } from 'react'
import type { Media } from '../features/anime/queries.ts'
import { isPlainClick } from './plainClick.ts'
import type { OpenTitle } from './TitleCard.tsx'

/**
 * Opens the title card instead of following the link, on a plain click; any other click follows
 * it as the browser would, to the title's address, which opens its card (the link works without
 * JS too).
 */
export const opener = (media: Media, onOpen?: OpenTitle) =>
  onOpen
    ? (event: MouseEvent<HTMLElement>) => {
        if (!isPlainClick(event)) return
        event.preventDefault()
        onOpen(media, event.currentTarget)
      }
    : undefined
