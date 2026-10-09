import { seasonOf, titleOf } from '../features/anime/format.ts'
import type { Media } from '../features/anime/queries.ts'
import { cssVars } from './cssVars.ts'
import { opener } from './opener.ts'
import { SfxHeading } from './SfxHeading.tsx'
import type { OpenTitle } from './TitleCard.tsx'

/** A row of cover panels that scrolls sideways, numbered like manga chapters. */
export function Strip({
  id,
  heading,
  sfx,
  titles,
  onOpen,
}: {
  id: string
  heading: string
  sfx: string
  titles: Media[]
  onOpen?: OpenTitle
}) {
  return (
    <section className="ab-strip" aria-labelledby={id}>
      <SfxHeading id={id} sfx={sfx} small>
        {heading}
      </SfxHeading>
      <ol className="ab-strip-row">
        {titles.map((media, i) => (
          <li key={media.id} className="ab-strip-item" style={cssVars({ '--i': i })}>
            <a
              className="ab-strip-panel"
              href={`#title-${media.id}`}
              onClick={opener(media, onOpen)}
            >
              <img src={media.coverImage.large} alt="" loading="lazy" />
              <span className="ab-chapter" aria-hidden="true">
                Ch.{i + 1}
              </span>
              <span className="ab-strip-title">{titleOf(media)}</span>
              <span className="sr-only">, {seasonOf(media)}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
