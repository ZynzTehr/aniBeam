/**
 * Opens the menu, focusing the link to the section the visitor is in, or the first, with the
 * keyboard's ring only when a key opened it (`byKey`). The hamburger takes focus first, if it
 * hasn't it (Safari doesn't focus a tapped button), so the dialog has it to give focus back to as
 * it shuts.
 */
export function openMenu(
  dialog: HTMLDialogElement | null,
  burger: HTMLElement | null,
  byKey: boolean,
) {
  if (!dialog || dialog.open) return
  if (burger && document.activeElement !== burger)
    burger.focus({ preventScroll: true, focusVisible: false })
  dialog.showModal()
  const link = dialog.querySelector<HTMLElement>('[aria-current]') ?? dialog.querySelector('a')
  link?.focus({ focusVisible: byKey })
}
