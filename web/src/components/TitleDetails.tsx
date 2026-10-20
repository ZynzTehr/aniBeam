import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { Media } from '../features/anime/queries.ts'
import { parseSynopsis, type Run } from '../features/anime/synopsis.ts'

/**
 * What the title card shows below its facts and buttons, last in it: the synopsis, five lines of
 * it until Read more, with its source as a caption. A list's copy of a title carries it (see
 * cardOf), so a card opened from a list shows it at once, with no request, and one opened at its
 * address shows it from that one request.
 */
export function TitleDetails({ media }: { media: Media }) {
  return (
    <div className="ab-details">
      <Synopsis description={media.description} />
    </div>
  )
}

/** A line's runs, in italics, in bold, or both, as AniList marked them: text, which React escapes. */
const runs = (line: Run[]) =>
  line.map(({ text, em, strong }, r) => {
    const content = strong ? <strong>{text}</strong> : text
    return <span key={r}>{em ? <em>{content}</em> : content}</span>
  })

/**
 * The synopsis, clamped to five lines, with Read more where the clamp hides some of it, and Show
 * less once it is open. Whether it does is measured as the card lays out, before the browser
 * draws it, and again whenever the clamped text changes size, as when the page's own font
 * arrives in place of a fallback or the screen turns: so the button comes with the text, and is
 * there only while the clamp hides something.
 */
function Synopsis({ description }: { description: string | null }) {
  const id = useId()
  const text = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const element = text.current
    if (!element || open) return
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1)
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(element)
    return () => resized.disconnect()
  }, [open])
  const { paragraphs, source } = parseSynopsis(description)
  if (paragraphs.length === 0) return <p className="ab-synopsis-none">Description unavailable.</p>
  return (
    <section className="ab-synopsis" aria-label="Synopsis">
      <div
        ref={text}
        id={id}
        className={['ab-synopsis-text', !open && 'is-clamped', !open && cut && 'is-cut']
          .filter(Boolean)
          .join(' ')}
      >
        {paragraphs.map((lines, p) => (
          <p key={p}>
            {lines.map((line, l) => (
              <span key={l}>
                {l > 0 && <br />}
                {runs(line)}
              </span>
            ))}
          </p>
        ))}
      </div>
      {(cut || open) && (
        <button
          type="button"
          className="ab-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={(event) => {
            // Closed from under a long synopsis, the button moves up with the text's foot, maybe
            // off the screen: it is brought back into view, at once, once the text has closed.
            const button = event.currentTarget
            setOpen(!open)
            if (open) requestAnimationFrame(() => button.scrollIntoView({ block: 'nearest' }))
          }}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
      {source && <p className="ab-source">Source: {source}</p>}
    </section>
  )
}
