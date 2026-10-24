import { useContext, useEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AfterHost } from './after.ts'
import { Debug } from './Debug.tsx'
import { tabStops } from './doors.ts'
import type { Lab, Options } from './switches.ts'
import type { useMood } from './useMood.ts'

/**
 * The lab's boxes for one machine, drawn after the site's footer (see SiteFrame), so they move
 * nothing on the page as they grow: the section's Tab stops, the status line as a screen reader
 * hears it, the last 20 rolls, and the scores.
 */
export function LabBoxes({
  name,
  section,
  options,
  lab,
  mood,
  extra,
}: {
  name: string
  section: RefObject<HTMLElement | null>
  options: Options
  lab: Lab
  mood: ReturnType<typeof useMood>
  extra?: ReactNode
}) {
  const host = useContext(AfterHost)
  const stops = useTabStops(section)
  const { gacha } = mood
  if (!host) return null
  return createPortal(
    <>
      <section className="ab-lab-box" aria-label={`Lab: ${name}`}>
        <h2 className="ab-lab-legend">
          <span className="ab-lab-tag">Lab</span> {name}
        </h2>
        <p className="ab-lab-why">
          Tab stops in this section: <b data-lab="stops">{stops}</b>. Titles in its machine:{' '}
          {mood.pool.length}. The status line:{' '}
          <q data-lab="heard">{gacha.status || 'nothing yet'}</q>
        </p>
        {extra}
      </section>
      {gacha.log.length > 0 && (
        <section className="ab-lab-box" aria-label={`Lab: the last 20 rolls, ${name}`}>
          <h2 className="ab-lab-legend">
            <span className="ab-lab-tag">Lab</span> The last 20 rolls
          </h2>
          <ol className="ab-lab-log">
            {gacha.log.slice(-20).map((row) => (
              <li key={row.roll} value={row.roll}>
                {row.title}{' '}
                <span className={row.repeat ? 'ab-lab-mark is-repeat' : 'ab-lab-mark'}>
                  {row.repeat ? 'repeat' : 'new'}
                </span>
                {row.sequel && <span className="ab-lab-mark is-sequel">sequel</span>}
              </li>
            ))}
          </ol>
          <p className="ab-lab-why">
            Different in the last 30 rolls: {gacha.distinct}. Sequels are the lab’s guess from the
            titles.
          </p>
        </section>
      )}
      {(lab.scores === 'on' || lab.spoilers === 'on') && (
        <Debug
          ranked={mood.ranked}
          scale={options.a6}
          scores={lab.scores === 'on'}
          spoilers={lab.spoilers === 'on'}
        />
      )}
    </>,
    host,
  )
}

/** The Tab stops in a part of the page, counted again as it changes. */
function useTabStops(part: RefObject<HTMLElement | null>) {
  const [stops, setStops] = useState(0)
  useEffect(() => {
    const root = part.current
    if (!root) return
    const count = () => setStops(tabStops(root))
    const watch = new MutationObserver(count)
    watch.observe(root, { subtree: true, childList: true, attributes: true })
    const first = setTimeout(count, 0)
    return () => {
      watch.disconnect()
      clearTimeout(first)
    }
  }, [part])
  return stops
}
