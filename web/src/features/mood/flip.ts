// The roll's flip on Discover's machine (F1, the user's pick, A9): the capsule drops, pops open,
// then the card turns from its back to the title's cover. Named once, here: the machine hands them
// to its stylesheet as --drop, --open and --flip (see PullMachine), and the browser checks time
// their moments from them, so a change to one can't leave a check looking at the wrong phase.

/** The capsule drops in, from the press. */
export const DROP_MS = 250

/** Then it pops open, as the card's two faces fade in behind it. */
export const OPEN_MS = 150

/** Then the card turns, from DROP_MS + OPEN_MS to ROLL_MS. */
export const FLIP_MS = 300

/** The whole roll, from the press until the card shows its title: 700 ms. */
export const ROLL_MS = DROP_MS + OPEN_MS + FLIP_MS
