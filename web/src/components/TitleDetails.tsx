import { useId, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Media, Tag } from '../features/anime/queries.ts'
import { parseSynopsis, type Run } from '../features/anime/synopsis.ts'
import { tagsOf } from '../features/anime/tags.ts'
import { pointed } from '../lib/jumps.ts'
import { reducedMotion } from '../lib/motion.ts'

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
    // Not while the text closes (see toggle): its height is then the animation's, not the clamp's.
    const measure = () =>
      element.hasAttribute('data-moving') || setCut(element.scrollHeight > element.clientHeight + 1)
    measure()
    const resized = new ResizeObserver(() => flushSync(measure))
    resized.observe(element)
    resized.observe(whole.current)
    return () => resized.disconnect()
  }, [open])
  /**
   * Opens the text or closes it. With motion allowed, its height moves from where it is to where
   * it goes, in 280 to 350 ms by its length, eased out, so the content below follows its foot, and
   * the fade at its foot slides down out of sight below it as it opens, and back as it closes (see
   * .ab-synopsis-text[data-moving]). A second press part way turns it back from where it is, in
   * the part of that time its way back takes. Under reduced motion it changes at once. `pointer`
   * says whether the press was a pointer's (a mouse, a finger, a pen) or a key's (see
   * lib/jumps.ts), which decides what opening scrolls (see below).
   */
  const toggle = (button: HTMLButtonElement, pointer: boolean) => {
    const element = text.current!
    const style = getComputedStyle(element)
    const height = () => parseFloat(style.height)
    const from = height()
    const turning = element.getAnimations().length > 0
    element.getAnimations().forEach((animation) => animation.cancel())
    element.removeAttribute('data-moving')
    flushSync(() => setOpen(!open))
    const to = height()
    const clamp = 5 * parseFloat(style.lineHeight)
    const travel = Math.max(element.scrollHeight - clamp, Math.abs(to - from), 1)
    // Closing, the button moves up with the text's foot, maybe off the screen, from under it: it is
    // kept in view, its ring too (see .ab-more's scroll-margin), in each frame as the browser is
    // about to draw it. Opening at a pointer's press, the reader keeps their place: the text opens
    // below the lines being read, and the card doesn't scroll. On a phone a long synopsis pushes
    // the button far down, and following it whipped those lines up off the screen's top. Opening
    // at a key's, the button, which has focus, is brought into view once the text has opened, as
    // near as it goes, smoothly (at once under reduced motion), so focus is never left off the
    // screen (WCAG 2.4.11).
    const keep = (behavior?: ScrollBehavior) =>
      button.scrollIntoView({ block: 'nearest', behavior })
    if (reducedMotion() || Math.abs(to - from) < 1)
      return void ((open || !pointer) && requestAnimationFrame(() => keep()))
    // How far the fade lies below the clamp's foot, at a height: all the way down, out of sight,
    // once the text is open. Its position goes by its prefixed name too, which Chrome 111 to 119
    // know it by: they drop a name they don't know, and the fade would stay put as the text moved.
    const fade = (height: number) =>
      `0 ${100 - Math.min(Math.max((height - clamp) / travel, 0), 1) * 100}%`
    let target = to
    const run = (from: number, duration: number, easing: string) => {
      const position = [fade(from), open ? '0 100%' : '0 0%']
      const moving = element.animate(
        {
          height: [`${from}px`, `${target}px`],
          maskPosition: position,
          webkitMaskPosition: position,
        },
        { duration, easing },
      )
      // Once the text has closed, whether the clamp hides anything is measured again, as the text
      // may have changed size as it moved. A second press cancels this, and its own animation does
      // it.
      moving.finished.then(
        () => {
          element.removeAttribute('data-moving')
          if (open) setCut(element.scrollHeight > element.clientHeight + 1)
        },
        () => {},
      )
      return moving
    }
    element.setAttribute('data-moving', '')
    // A soft ease out, a third of the way in its first 40 ms, where a steeper one leapt half way.
    // Turning back, or going on to a new height, it sets off slowly, as from a stop, not at an ease
    // out's first speed.
    const soft = 'cubic-bezier(0.4, 0, 0.2, 1)'
    let moving = run(
      from,
      Math.max(120, (Math.abs(to - from) / travel) * Math.min(350, 280 + travel / 20)),
      turning ? soft : 'cubic-bezier(0.3, 0.6, 0.3, 1)',
    )
    // Following the button stops once the visitor scrolls, with a wheel, a finger or a key, so the
    // card is left where they take it.
    const quit = new AbortController()
    for (const type of ['wheel', 'touchstart', 'keydown'])
      addEventListener(type, () => quit.abort(), { passive: true, signal: quit.signal })
    requestAnimationFrame(function follow() {
      if (moving.playState !== 'running') {
        if (!open && !pointer && !quit.signal.aborted && moving.playState == 'finished')
          keep('smooth')
        return quit.abort()
      }
      // A text that reflows as it opens, as when the screen turns, grows on from where it is to its
      // new height, in the time left or 280 ms if that is longer, as its new way may be the longer:
      // it grew to the old height and then snapped to the new one in a frame.
      const full = whole.current!.getBoundingClientRect().height
      if (!open && Math.abs(full - target) > 1) {
        const now = height()
        const left = Number(moving.effect!.getComputedTiming().endTime) - Number(moving.currentTime)
        moving.cancel()
        target = full
        moving = run(now, Math.max(left, 280), soft)
      }
      if (open && !quit.signal.aborted) keep()
      requestAnimationFrame(follow)
    })
  }
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
          onClick={(event) => toggle(event.currentTarget, pointed(event.nativeEvent))}
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
