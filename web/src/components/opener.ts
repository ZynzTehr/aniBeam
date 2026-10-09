import type { MouseEvent } from 'react'
import type { Media } from '../features/anime/queries.ts'
import type { OpenTitle } from './TitleCard.tsx'

/** Opens the title card instead of following the link (the link still works without JS). */
export const opener = (media: Media, onOpen?: OpenTitle) =>
  onOpen
    ? (event: MouseEvent<HTMLElement>) => {
        event.preventDefault()
        onOpen(media, event.currentTarget)
      }
    : undefined
