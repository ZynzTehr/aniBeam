import { useId, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Media, Tag } from '../features/anime/queries.ts'
import { parseSynopsis, type Run } from '../features/anime/synopsis.ts'
import { tagsOf } from '../features/anime/tags.ts'

/**
 * What the title card shows below its facts and buttons, last in it: the synopsis, five lines of
 * it until Read more, with its source as a caption, and the tags, spoilers behind a button. A
 * list's copy of a title carries them (see cardOf), so a card opened from a list shows them at
 * once, with no request, and one opened at its address shows them from that one request.
 */
export function TitleDetails({ media }: { media: Media }) {
  return (
    <div className="ab-details">
      <Synopsis description={media.description} />
      <Tags tags={media.tags} />
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
 * draws it, and again whenever the text changes size, as when the page's own font arrives in
 * place of a fallback or the screen turns: so the button comes with the text, and is there only
 * while the clamp hides something. The text is watched whole, inside the clamp, as well as the
 * clamp itself: text that reflows past five lines, or back to five, leaves the clamp as tall as
 * it was, and watching only the clamp would miss it. A card opened from a list lays out its text
 * only as the dialog opens, after this has rendered, so the first measure that counts is the
 * watcher's, which the browser makes before it draws the frame: it renders the button at once
 * (flushSync), rather than a frame later, when it pushed the tags down.
 */
function Synopsis({ description }: { description: string | null }) {
  const id = useId()
  const text = useRef<HTMLDivElement>(null)
  const whole = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const element = text.current
    if (!element || !whole.current || open) return
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1)
    measure()
    const resized = new ResizeObserver(() => flushSync(measure))
    resized.observe(element)
    resized.observe(whole.current)
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
        <div ref={whole}>
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
      </div>
      {(cut || open) && (
        <button
          type="button"
          className="ab-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={(event) => {
            // The button moves with the text's foot, maybe off the screen: down below it as the
            // text opens above it (on a phone, a long synopsis pushes it past the screen's foot),
            // and up as it closes from under it. Either way it is brought back into view, its ring
            // too (see .ab-more's scroll-margin), before the browser draws the text's new height.
            const button = event.currentTarget
            setOpen(!open)
            requestAnimationFrame(() => button.scrollIntoView({ block: 'nearest' }))
          }}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
      {source && <p className="ab-source">Source: {source}</p>}
    </section>
  )
}

/**
 * A tag as a chip, with its rank, how strongly it fits the title, where AniList gives one. A
 * spoiler's dashed border shows it only to the eye, so it says so in words to a screen reader.
 */
const chip = (tag: Tag, spoiler: boolean) => (
  <li key={tag.name} className={spoiler ? 'is-spoiler' : undefined}>
    {tag.name}
    {tag.rank !== null && <small> {tag.rank}%</small>}
    {spoiler && <span className="sr-only">, spoiler</span>}
  </li>
)

/**
 * The title's top tags by rank, never an adult one, and its top spoiler tags only once "Show
 * spoiler tags" is pressed (spec §3G): they join the list in place, after the others, marked as
 * spoilers to the eye and in words, and go again at a second press. A title with no spoiler tags
 * has no button.
 */
function Tags({ tags }: { tags: Tag[] }) {
  const id = useId()
  const [spoilersShown, setSpoilersShown] = useState(false)
  const { shown, spoilers } = tagsOf(tags)
  if (shown.length + spoilers.length === 0) return null
  return (
    <section className="ab-tag-set" aria-label="Tags">
      <ul id={id} className="ab-tags">
        {shown.map((tag) => chip(tag, false))}
        {spoilersShown && spoilers.map((tag) => chip(tag, true))}
      </ul>
      {spoilers.length > 0 && (
        <button
          type="button"
          className="ab-more"
          aria-expanded={spoilersShown}
          aria-controls={id}
          onClick={() => setSpoilersShown(!spoilersShown)}
        >
          Show spoiler tags
        </button>
      )}
    </section>
  )
}
