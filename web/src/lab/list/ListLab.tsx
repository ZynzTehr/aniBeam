import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import css from './lab.css?inline'
import { Panel } from './Panel.tsx'
import { setStorage } from './sandbox.ts'
import { Stage } from './Stage.tsx'
import { read, SECTIONS, write, type Lab, type Options, type Section } from './switches.ts'

const params = () => new URLSearchParams(location.search)

/**
 * Draft PR 0's My List lab, at ?proto=list: the Phase 4 plan's open choices (D1 to D14), tried on
 * the site's own components. It never merges. It is its own chunk, fetched only at its address,
 * and asks AniList's API for nothing: its titles are the bundled samples and three saved ones (see
 * pool.ts), and its list is a sandbox under anibeam:lab-list (see sandbox.ts). Its stylesheet comes
 * inline with its code, so the site's own stylesheet is the same without it.
 *
 * The lab is a shell, with the switches beside it (below on a phone), around a stage: the same
 * address with &stage=, in a frame, so each section draws at a true width (the site's layouts
 * follow the screen's width, which a frame has of its own), and the title card opens as the real
 * modal card without locking the switches. The shell hands every change to the stage as a
 * message; the list reaches it as a storage event.
 */
export default function ListLab() {
  const section = params().get('stage')
  return (
    <>
      <style>{css}</style>
      {section && SECTIONS.some(({ key }) => key === section) ? (
        <Stage section={section as Section} />
      ) : (
        <Shell />
      )}
    </>
  )
}

/** What the stage frame draws on, as the room there is. */
type Room = { width: number; height: number }

function Shell() {
  const [state, setState] = useState(() => read(params()))
  const { options, lab } = state
  // The stage: loaded again only for a new section or Replay; every other change is a message.
  const [src, setSrc] = useState(() => write(options, lab, { stage: lab.section }))
  const update = (next: { options: Options; lab: Lab }) => {
    setState(next)
    history.replaceState(null, '', write(next.options, next.lab))
    if (next.lab.section !== lab.section)
      setSrc(write(next.options, next.lab, { stage: next.lab.section }))
  }
  const choose = (key: keyof Options, value: string) =>
    update({ options: { ...options, [key]: value }, lab })
  const setLab = (patch: Partial<Lab>) => update({ options, lab: { ...lab, ...patch } })
  useEffect(() => setStorage(lab.storage), [lab.storage])

  const frame = useRef<HTMLIFrameElement>(null)
  const [replays, setReplays] = useState(0)
  const post = () =>
    frame.current?.contentWindow?.postMessage({ type: 'ab-lab', options, lab }, location.origin)
  useEffect(post)

  // The room for the stage: the screen under the lab's bar, and above the switches' handle on a
  // phone, where they are a sheet at the screen's foot.
  const root = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<Room>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = root.current
    const stage = box.current
    if (!element || !stage) return
    const measure = () => {
      const bar = element.querySelector<HTMLElement>('.ab-lab-bar')?.offsetHeight ?? 0
      const handle = element.querySelector<HTMLElement>('.ab-lab-handle')
      const sheet = handle && getComputedStyle(handle).display !== 'none' ? handle.offsetHeight : 0
      element.style.setProperty('--ab-lab-top', `${bar}px`)
      element.style.setProperty('--ab-lab-foot', `${sheet}px`)
      setRoom({ width: stage.clientWidth, height: stage.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const fixed = lab.width === 'fit' ? null : Number(lab.width)
  const scale = fixed && room.width ? Math.min(1, room.width / fixed) : 1
  const frameStyle = fixed
    ? {
        width: fixed,
        height: room.height / scale,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        marginLeft: Math.max(0, (room.width - fixed) / 2),
      }
    : undefined
  const sectionName = SECTIONS.find(({ key }) => key === lab.section)?.name

  return (
    <div ref={root} className="ab-lab">
      <title>My List lab · AniBeam</title>
      <header className="ab-lab-bar">
        <h1 className="ab-lab-name">
          AniBeam <b>My List lab</b> <small>Draft, never merged</small>
        </h1>
        <nav className="ab-lab-sections" aria-label="Lab sections">
          {SECTIONS.map(({ key, name }) => (
            <button
              key={key}
              type="button"
              className="ab-lab-button"
              aria-pressed={lab.section === key}
              onClick={() => setLab({ section: key })}
            >
              {name}
            </button>
          ))}
        </nav>
      </header>
      <div className="ab-lab-body">
        <main id="main" className="ab-lab-main">
          <p className="ab-lab-caption">
            <b>{sectionName}</b>{' '}
            {fixed
              ? `at ${fixed}px${scale < 1 ? `, shown at ${Math.round(scale * 100)}%` : ''}`
              : `at ${Math.round(room.width)}px, the room there is`}
          </p>
          <div ref={box} className="ab-lab-room">
            {lab.section === 'wording' ? (
              <p className="ab-lab-why">The wording comes in a later commit.</p>
            ) : (
              <iframe
                key={`${src}-${replays}`}
                ref={frame}
                className="ab-lab-frame"
                title={`The lab’s stage: ${sectionName}`}
                src={src}
                style={frameStyle}
                onLoad={post}
              />
            )}
          </div>
        </main>
        <Panel
          options={options}
          lab={lab}
          onChoose={choose}
          onLab={setLab}
          onReplay={() => setReplays(replays + 1)}
        />
      </div>
    </div>
  )
}
