import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Options } from './choices.ts'
import { creditsOf, synopsisOf, tagsOf, type Run } from './details.ts'
import type { LabTag, LabTitle } from './types.ts'

/**
 * What PR 13 adds below the actions, last in the sheet: the synopsis with its source as a caption,
 * the tags with spoilers behind "Show spoiler tags", and, if chosen, the Director and Music
 * credits. A lab note (dashed, marked "Lab") says what the saved answers lack; it is not part of
 * the design.
 */
export function LabDetails({ title, options }: { title: LabTitle; options: Options }) {
  const credits = creditsOf(title)
  return (
    <div className="ab-lab-details">
      {/* Keyed, so another title or clamp starts closed. */}
      <Synopsis
        key={`${title.id} ${title.description === null} ${options.synopsis}`}
        description={title.description}
        clamped={options.synopsis === 'clamped'}
      />
      {options.staff === 'now' && (
        <dl className="ab-lab-credits">
          {credits ? (
            <>
              <Credit role="Director" name={credits.director} />
              <Credit role="Music" name={credits.music} />
            </>
          ) : (
            <LabNote>The saved answer for this title holds no staff.</LabNote>
          )}
        </dl>
      )}
      <Tags key={title.id} title={title} cap={options.tags === '8' ? 8 : Infinity} />
    </div>
  )
}

/** A note from the lab, not part of the design. */
function LabNote({ children }: { children: ReactNode }) {
  return (
    <p className="ab-lab-note">
      <b>Lab</b> {children}
    </p>
  )
}

function Credit({ role, name }: { role: string; name: string | null }) {
  return (
    <div>
      <dt>{role}</dt>
      <dd>
        {name ?? (
          <span className="ab-lab-missing">
            <b>Lab</b> not among the saved credits
          </span>
        )}
      </dd>
    </div>
  )
}

const runs = (line: Run[]) =>
  line.map(({ text, em, strong }, r) => {
    const content = strong ? <strong>{text}</strong> : text
    return <span key={r}>{em ? <em>{content}</em> : content}</span>
  })

function Synopsis({ description, clamped }: { description: string | null; clamped: boolean }) {
  const id = useId()
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  // Read more shows only where the clamp hides something.
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const element = body.current
    setOverflows(Boolean(element && element.scrollHeight > element.clientHeight + 1))
  }, [description, clamped, open])
  if (!description) return <p className="ab-lab-synopsis ab-lab-none">Description unavailable.</p>
  const { paragraphs, source } = synopsisOf(description)
  const cut = clamped && !open
  return (
    <section className="ab-lab-synopsis" aria-label="Synopsis">
      <div ref={body} id={id} className={cut ? 'ab-lab-text is-cut' : 'ab-lab-text'}>
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
      {clamped && (overflows || open) && (
        <button
          type="button"
          className="ab-lab-more"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
      {source && <p className="ab-lab-source">Source: {source}</p>}
    </section>
  )
}

function TagList({ tags, id }: { tags: LabTag[]; id?: string }) {
  return (
    <ul className="ab-lab-tags" id={id}>
      {tags.map((tag, t) => (
        <li key={t} className={tag.spoiler ? 'is-spoiler' : undefined}>
          {tag.name ?? <span className="ab-lab-missing">no name saved</span>}{' '}
          <small>{tag.rank}%</small>
        </li>
      ))}
    </ul>
  )
}

function Tags({ title, cap }: { title: LabTitle; cap: number }) {
  const id = useId()
  const [spoilersShown, setSpoilersShown] = useState(false)
  const { shown, spoilers, left, spoilersLeft } = tagsOf(title, cap)
  if (shown.length + spoilers.length === 0) return null
  return (
    <section className="ab-lab-tag-set" aria-label="Tags">
      <TagList tags={shown} />
      {spoilers.length > 0 && (
        <button
          type="button"
          className="ab-lab-more"
          aria-expanded={spoilersShown}
          aria-controls={id}
          onClick={() => setSpoilersShown(!spoilersShown)}
        >
          Show spoiler tags
        </button>
      )}
      {spoilers.length > 0 && <div id={id}>{spoilersShown && <TagList tags={spoilers} />}</div>}
      <LabNote>
        {shown.length} of {shown.length + left} tags by rank
        {spoilers.length > 0 &&
          `; ${spoilers.length} of ${spoilers.length + spoilersLeft} spoiler tags behind the button`}
        {title.tags.some((tag) => tag.name === null) && '; the saved answer has no tag names'}.
      </LabNote>
    </section>
  )
}
