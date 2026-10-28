import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import css from './lab.css?inline'
import { guardFetch, refusedRequests } from './page.ts'
import { Panel } from './Panel.tsx'
import { Stage, type Message, type Report } from './Stage.tsx'
import { DEFAULTS, LOOKS, read, VIEW_DEFAULTS, write, type Options, type View } from './switches.ts'

// Measured on a scratch copy of main (lab-spec.md, section 4): each look's CSS built into the
// real stylesheet, and a real Stamp component with its call sites and My List's rule, with no lab
// code, against main's 12,897 B of CSS and 94,650 B of JS every visit loads (brotli 11).
const BYTES: Record<Options['s1'], string> = {
  a: 'CSS +107 B, JS +237 B; the slam +40 B CSS, +11 B JS',
  b: 'CSS +141 B, JS +286 B',
  c: 'CSS +193 B, JS +210 B',
}
// Measured for look A only; the other looks should cost about the same.
const ADD_ONS = "Of the JS, My List's rule (S8 a) is 175 B; heart only (S3 b) saves 149 B"

guardFetch()

/**
 * Draft only, never merged: the stamps lab at ?proto=stamps (Phase 4's optional PR 4, item 1), where
 * the stamps on listed covers can be tried on the site's own surfaces and each choice picked (see
 * design-research/phase-4/stamps/lab-spec.md). It is its own chunk, fetched only at its address,
 * and asks AniList's API for nothing. Its stylesheet comes inline with its code, so the site's own
 * stylesheet is the same without it.
 *
 * The lab is a shell, with the switches beside it (a sheet on a phone), around a stage: the same
 * address with &stage=1, in a frame, so the site's layouts draw at a true width. The shell hands
 * each change to the stage as a message; the list reaches it as a storage event.
 */
export default function StampsLab() {
  const stage = new URLSearchParams(location.search).has('stage')
  return (
    <>
      <style>{css}</style>
      {stage ? <Stage /> : <Shell />}
    </>
  )
}

type Room = { width: number; height: number }

const EMPTY: Report = { requests: 0, stops: 0, stopsBare: 0, heard: '', shift: null, matches: [] }

function Shell() {
  const [{ options, view }, setState] = useState(() => read(new URLSearchParams(location.search)))
  const [src] = useState(() => write(options, view, { stage: '1' }))
  const update = (next: { options: Options; view: View }) => {
    setState(next)
    history.replaceState(null, '', write(next.options, next.view))
  }

  const frame = useRef<HTMLIFrameElement>(null)
  const send = (message: Message) =>
    frame.current?.contentWindow?.postMessage(message, location.origin)
  const post = () => send({ type: 'ab-lab', options, view })
  useEffect(post)

  const [report, setReport] = useState(EMPTY)
  useEffect(() => {
    const heard = ({ origin, data }: MessageEvent) => {
      if (origin === location.origin && data?.type === 'ab-lab-report') setReport(data.report)
    }
    addEventListener('message', heard)
    return () => removeEventListener('message', heard)
  }, [])

  // The room for the stage: the screen under the bar and the readouts, above the switches' bar on
  // a phone, where they are a sheet at the screen's foot.
  const root = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<Room>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = root.current
    const stage = box.current
    if (!element || !stage) return
    const measure = () => {
      const handle = element.querySelector<HTMLElement>('.ab-lab-handle')
      const sheet = handle && getComputedStyle(handle).display !== 'none' ? handle.offsetHeight : 0
      element.style.setProperty('--ab-lab-foot', `${sheet}px`)
      element.style.setProperty('--ab-lab-head', `${stage.offsetTop}px`)
      setRoom({ width: stage.clientWidth, height: stage.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const fixed = view.width === 'fit' ? null : Number(view.width)
  const scale = fixed && room.width ? Math.min(1, room.width / fixed) : 1
  const frameStyle = fixed
    ? {
        width: fixed,
        height: room.height / scale,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        marginLeft: Math.max(0, (room.width - fixed) / 2),
      }
    : undefined
  const requests = report.requests + refusedRequests()
  const look = LOOKS.find(({ value }) => value === options.s1)!

  return (
    <div ref={root} className="ab-lab">
      <title>Stamps lab · AniBeam</title>
      <div className="ab-lab-body">
        <main id="main" className="ab-lab-main">
          <header className="ab-lab-bar">
            <h1 className="ab-lab-name">
              AniBeam <b>Stamps lab</b> <small>Draft, never merged</small>
            </h1>
            <p className="ab-lab-caption">
              {fixed
                ? `At ${fixed}px${scale < 1 ? `, shown at ${Math.round(scale * 100)}%` : ''}`
                : `Fit: ${Math.round(room.width)}px wide`}
            </p>
          </header>
          <dl className="ab-lab-readouts" aria-live="off">
            <div className={requests ? 'is-bad' : undefined}>
              <dt>Requests to AniList</dt>
              <dd>{requests}</dd>
            </div>
            <div className={report.stops !== report.stopsBare ? 'is-bad' : undefined}>
              <dt>Tab stops</dt>
              <dd>
                {report.stops} <small>({report.stopsBare} with no stamps)</small>
              </dd>
            </div>
            <div className={report.shift ? 'is-bad' : undefined}>
              <dt>Layout shift since the last change</dt>
              <dd>
                {report.shift === null ? 'not measured in this browser' : report.shift.toFixed(3)}
              </dd>
            </div>
            <div>
              <dt>Bytes ({look.short})</dt>
              <dd>
                {BYTES[options.s1]}. <small>{ADD_ONS}</small>
              </dd>
            </div>
            <div className="ab-lab-heard">
              <dt>Reads as</dt>
              <dd>{report.heard ? `“${report.heard}”` : 'focus or hover a cover'}</dd>
            </div>
          </dl>
          <div ref={box} className="ab-lab-room">
            <iframe
              ref={frame}
              className="ab-lab-frame"
              title="The lab’s stage"
              src={src}
              style={frameStyle}
              onLoad={post}
            />
          </div>
        </main>
        <Panel
          options={options}
          view={view}
          matches={report.matches}
          onOptions={(next) => update({ options: next, view })}
          onView={(next) => update({ options, view: next })}
          onJump={(section) => send({ type: 'ab-lab-jump', section })}
          onReset={() =>
            update({ options: DEFAULTS, view: { ...VIEW_DEFAULTS, width: view.width } })
          }
        />
      </div>
    </div>
  )
}
