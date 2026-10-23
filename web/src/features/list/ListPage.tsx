import { Strip } from '../../components/Strip.tsx'

/**
 * My List (spec §3F), at /list, in Discover's place. Drawn on its own, as App leaves Discover's
 * lists off here, so the page asks AniList for none of them.
 */
export function ListPage() {
  return (
    <>
      <title>My List · AniBeam</title>
      <Strip
        id="ab-list"
        level="h1"
        heading="My List"
        sfx="マイリスト"
        titles={[]}
        live={false}
        grid
      />
    </>
  )
}
