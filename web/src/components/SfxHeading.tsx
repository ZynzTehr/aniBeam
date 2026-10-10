import type { ReactNode } from 'react'

/** A section heading with a manga sound effect beside it. The effect is decoration only. */
export function SfxHeading({
  as: Heading = 'h2',
  id,
  sfx,
  small = false,
  children,
}: {
  as?: 'h1' | 'h2'
  id: string
  sfx: string
  small?: boolean
  children: ReactNode
}) {
  return (
    // tabIndex -1: script can move focus here (see RetryButton), but Tab skips it.
    <Heading id={id} tabIndex={-1} className={small ? 'ab-sfx ab-sfx-small' : 'ab-sfx'}>
      {children}
      <span aria-hidden="true">{sfx}</span>
    </Heading>
  )
}
