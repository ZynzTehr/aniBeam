import { useEffect, useLayoutEffect, useState } from 'react'
import { CardStage } from './CardStage.tsx'
import { CoversStage } from './CoversStage.tsx'
import { HeaderStage } from './HeaderStage.tsx'
import { PageStage } from './PageStage.tsx'
import { PullStage } from './PullStage.tsx'
import { setStorage } from './sandbox.ts'
import { read, SECTIONS, type Lab, type Options, type Section } from './switches.ts'

/** The lab's choices and state, as the shell last sent them (see ListLab). */
export type Shown = { options: Options; lab: Lab }

/**
 * One section of the lab, drawn in the shell's frame at the width the shell gives it. It starts
 * from the address and follows the shell's messages; the list follows the sandbox.
 */
export function Stage({ section }: { section: Section }) {
  const [shown, setShown] = useState<Shown>(() => read(new URLSearchParams(location.search)))
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data?.type === 'ab-lab')
        setShown({ options: event.data.options, lab: event.data.lab })
    }
    addEventListener('message', heard)
    return () => removeEventListener('message', heard)
  }, [])
  const { options, lab } = shown
  useEffect(() => setStorage(lab.storage), [lab.storage])
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
  const name = SECTIONS.find(({ key }) => key === section)?.name
  return (
    <div className="ab-lab-page">
      <title>{`${name} · My List lab`}</title>
      {section === 'card' ? (
        <CardStage options={options} title={lab.title} />
      ) : section === 'covers' ? (
        <CoversStage options={options} />
      ) : section === 'page' ? (
        <PageStage options={options} lab={lab} />
      ) : section === 'header' ? (
        <HeaderStage options={options} />
      ) : section === 'pull' ? (
        <PullStage options={options} />
      ) : (
        <main id="main">
          <p className="ab-lab-why">{name}: built in a later commit.</p>
        </main>
      )}
    </div>
  )
}
