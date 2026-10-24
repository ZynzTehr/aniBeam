import { useRequests } from './sandbox.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import css from './lab.css?inline'
import { Panel } from './Panel.tsx'
import { Stage } from './Stage.tsx'
import { read, SECTIONS, write, type Lab, type Options } from './switches.ts'
import { Wording } from './Wording.tsx'

const params = () => new URLSearchParams(location.search)

/** What the stage reports to the shell: its requests, and how its rolls are going. */
export type Report = { type: 'ab-lab-up'; requests: number; distinct: number; rolls: number }

/** What the shell asks the stage to do (the panel's buttons). */
export type Command = 'reset' | 'twenty' | 'leave3' | 'drain' | 'roll20'

/**
 * Draft PR 0's Mood lab, at ?proto=mood: the Phase 5 plan's open choices (A1 to A13, and B2),
 * tried on the site's own parts (MoodSlider, the My List controls, the title card, the pull
 * machine's classes) with the draft scoring and roll rules PR 2 will land. It never merges. It is
 * its own chunk, fetched only at its address, and asks AniList's API for nothing: its titles are
 * the browser checks' recordings (see pool.ts), and its list is a sandbox under anibeam:lab-list
 * (see sandbox.ts, imported first). Its stylesheet comes inline with its code, so the site's own
 * stylesheet is the same without it.
 *
 * The lab is a shell, with the switches beside it (below on a phone), around a stage: the same
 * address with &stage=, in a frame, so each section draws at a true width (the site's layouts
 * follow the screen's width, which a frame has of its own), and the title card opens as the real
 * modal card without locking the switches. The shell hands every change to the stage as a message.
 */
export default function MoodLab() {
  const section = params().get('stage')
  return (
    <>
      <style>{css}</style>
      {section && SECTIONS.some(({ key }) => key === section) ? <Stage /> : <Shell />}
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
  const [replays, setReplays] = useState(0)
  const update = (next: { options: Options; lab: Lab }, reload = false) => {
    setState(next)
    history.replaceState(null, '', write(next.options, next.lab))
    if (reload || next.lab.section !== lab.section) {
      setSrc(write(next.options, next.lab, { stage: next.lab.section }))
      setReplays((n) => n + 1)
    }
  }
  const choose = (key: keyof Options, value: string) =>
    update({ options: { ...options, [key]: value }, lab })
  const setLab = (patch: Partial<Lab>) => update({ options, lab: { ...lab, ...patch } })
  // The wording's "See it": a section, with any state and choices, loaded again.
  const goTo = (patch: Partial<Lab>, picks: Partial<Options> = {}) =>
    update({ options: { ...options, ...picks }, lab: { ...lab, ...patch } }, true)

  const frame = useRef<HTMLIFrameElement>(null)
  const post = () =>
    frame.current?.contentWindow?.postMessage({ type: 'ab-lab', options, lab }, location.origin)
  useEffect(post)
  const command = (what: Command) =>
    frame.current?.contentWindow?.postMessage({ type: 'ab-lab-do', what }, location.origin)

  // The stage's report: its requests, added to the shell's own, and its rolls.
  const own = useRequests()
  const [report, setReport] = useState<Report>({
    type: 'ab-lab-up',
    requests: 0,
    distinct: 0,
    rolls: 0,
  })
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data?.type === 'ab-lab-up')
        setReport(event.data as Report)
    }
    addEventListener('message', heard)
    return () => removeEventListener('message', heard)
  }, [])
  // A new stage starts its count again, and says so as it loads (see Stage).

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
  // The wording is text in the shell, which scrolls; every other section is the stage's frame.
  const text = lab.section === 'wording'
  const requests = own + report.requests

  return (
    <div ref={root} className="ab-lab">
      <title>Mood lab · AniBeam</title>
      <header className="ab-lab-bar">
        <h1 className="ab-lab-name">
          <span className="ab-lab-wide">AniBeam </span>
          <b>Mood lab</b> <small className="ab-lab-wide">Draft, never merged</small>
        </h1>
        {/* Not a live region: a roll is read once, from the stage's status line, and these change
            with every roll. On a phone they take their short words, to keep the bar to two rows. */}
        <p className="ab-lab-counters">
          <span className={requests ? 'ab-lab-counter is-bad' : 'ab-lab-counter'}>
            <span className="ab-lab-wide">AniList requests: </span>
            <span className="ab-lab-narrow">Requests: </span>
            <b data-lab="requests">{requests}</b>
          </span>
          <span className="ab-lab-counter">
            <span className="ab-lab-wide">Different in the last 30 rolls: </span>
            <span className="ab-lab-narrow">Last 30 rolls, different: </span>
            <b data-lab="distinct">{report.distinct}</b>
          </span>
        </p>
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
            {text
              ? ''
              : fixed
                ? `at ${fixed}px${scale < 1 ? `, shown at ${Math.round(scale * 100)}%` : ''}`
                : `at ${Math.round(room.width)}px, the room there is`}
            <span className="ab-lab-data">
              Lab data: 177 recorded titles. The real pool is about 100 popular titles per era.
            </span>
          </p>
          <div ref={box} className={text ? 'ab-lab-room ab-lab-room-text' : 'ab-lab-room'}>
            {text ? (
              <Wording goTo={goTo} />
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
          onReplay={() => update(state, true)}
          onCommand={command}
        />
      </div>
    </div>
  )
}
