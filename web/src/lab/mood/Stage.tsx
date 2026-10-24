import { useEffect, useLayoutEffect, useState } from 'react'
import type { Command, Report } from './MoodLab.tsx'
import { MoodStage } from './MoodStage.tsx'
import { useRequests } from './sandbox.ts'
import { read, SECTIONS, type Lab, type Options } from './switches.ts'

/** The lab's choices and state, as the shell last sent them (see MoodLab). */
export type Shown = { options: Options; lab: Lab }

/** How a section hears the panel's buttons: a command, numbered so a repeat is heard too. */
export type Heard = { what: Command; n: number } | null

/**
 * One section of the lab, drawn in the shell's frame at the width the shell gives it. It starts
 * from the address and follows the shell's messages, and reports its requests back.
 */
export function Stage() {
  const [shown, setShown] = useState<Shown>(() => read(new URLSearchParams(location.search)))
  const [heard, setHeard] = useState<Heard>(null)
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin !== location.origin) return
      if (event.data?.type === 'ab-lab')
        setShown({ options: event.data.options, lab: event.data.lab })
      if (event.data?.type === 'ab-lab-do')
        setHeard((before) => ({ what: event.data.what, n: (before?.n ?? 0) + 1 }))
    }
    addEventListener('message', listen)
    return () => removeEventListener('message', listen)
  }, [])
  const { lab } = shown
  // The lab's Reduce motion switch: the site's own setting, for this frame only, so it never
  // changes the visitor's saved choice.
  useLayoutEffect(() => {
    const root = document.documentElement
    const before = root.dataset.motion
    if (lab.motion === 'reduce') root.dataset.motion = 'reduce'
    return () => {
      if (before) root.dataset.motion = before
      else delete root.dataset.motion
    }
  }, [lab.motion])
  const requests = useRequests()
  const [rolls, setRolls] = useState({ distinct: 0, rolls: 0 })
  useEffect(() => {
    const report: Report = { type: 'ab-lab-up', requests, ...rolls }
    parent.postMessage(report, location.origin)
  }, [requests, rolls])
  const name = SECTIONS.find(({ key }) => key === lab.section)?.name
  return (
    <div className="ab-lab-page">
      <title>{`${name} · Mood lab`}</title>
      {lab.section === 'mood' ? (
        <MoodStage shown={shown} heard={heard} onRolls={setRolls} />
      ) : (
        <main id="main">
          <p className="ab-lab-why">{name}: built in a later commit.</p>
        </main>
      )}
    </div>
  )
}
