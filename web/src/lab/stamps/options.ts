import { createContext } from 'react'
import { DEFAULTS, type Options } from './switches.ts'

/** The switches as the shell last sent them, for the stamps the stage draws. */
export const LabOptions = createContext<Options>(DEFAULTS)
