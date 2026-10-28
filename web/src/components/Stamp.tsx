import { createElement, useContext } from 'react'
import { StampDraw, type StampSlot } from './stampDraw.ts'

// Draft only, never merged: the stamps lab's slot on a listed cover (Phase 4's optional PR 4,
// item 1). Each place a stamp can go holds a Stamp, which draws nothing unless the lab, at
// ?proto=stamps, hands it a way to draw one (StampDraw): so the site draws exactly what it drew
// before, and the lab tries every look on the site's own covers, from its own chunk. The real
// build replaces this file with the picked look alone.

/** A listed cover's stamp, if the lab draws one (see StampDraw). */
export function Stamp(slot: StampSlot) {
  const Draw = useContext(StampDraw)
  return Draw && createElement(Draw, slot)
}
