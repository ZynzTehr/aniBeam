import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Strip } from '../../components/Strip.tsx'
import type { OpenTitle } from '../../components/TitleCard.tsx'
import { listQuery } from '../anime/queries.ts'
import { listedIds } from './store.ts'

/**
 * My List (spec §3F), at /list, in Discover's place, and under a title's card opened over it.
 * Drawn on its own, as App leaves Discover's lists off here, so the page asks AniList for none of
 * them. Its titles are those saved as it opens, the 50 most lately changed (AniList's page), asked
 * for in one request: an edit from a card opened over it changes neither which titles show nor
 * their order, and asks for nothing (spec §3H).
 */
export function ListPage({ onOpen }: { onOpen: OpenTitle }) {
  const [ids] = useState(() => listedIds().slice(0, 50))
  const list = useQuery({ ...listQuery(ids), enabled: ids.length > 0 })
  // AniList gives the titles in an order of its own, so the list's comes back.
  const titles = useMemo(
    () => ids.flatMap((id) => list.data?.find((media) => media.id === id) ?? []),
    [ids, list.data],
  )
  return (
    <>
      <title>My List · AniBeam</title>
      <Strip
        id="ab-list"
        level="h1"
        heading="My List"
        sfx="マイリスト"
        titles={titles}
        loading={ids.length > 0 && list.isPending}
        onOpen={onOpen}
        live={false}
        grid
      />
    </>
  )
}
