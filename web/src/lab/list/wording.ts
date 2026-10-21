// D14: every new line the plan proposes, in one place, so the lab shows each where it would be
// and the wording section lists them for approval in one pass.

export const WORDS = {
  group: 'My List',
  save: 'Save',
  saved: 'Saved',
  want: 'Want to try',
  favorite: 'Favorite',
  movedWant: 'Moved to Want to try',
  movedSaved: 'Moved to Saved',
  removed: 'Removed from My List',
  kept: 'Couldn’t save on this device. Kept for this visit.',
  full: 'My List is full (2,000)',
  favoritesOnly: 'Favorites only',
  emptySaved: 'Nothing saved yet.',
  emptyWant: 'Nothing to try yet.',
  browse: 'Browse what’s trending',
  emptyFavorites: 'No favorites in Saved yet.',
  showAll: 'Show all',
  undo: 'Undo',
  removeThem: 'Remove them',
  fifty: 'Showing your 50 most recent.',
  browserOnly: 'Saved in this browser only.',
  offline: 'Offline: showing saved results',
  unavailableOffline: 'Details unavailable offline',
  kana: 'マイリスト',
}

/** "Removed from Saved." in the Undo slot, for the tab it was removed from. */
export const removedFrom = (tab: string) => `Removed from ${tab}.`

/** "2 titles couldn’t be shown." */
export const missingLine = (count: number) =>
  `${count} ${count === 1 ? 'title' : 'titles'} couldn’t be shown.`

/** A tab's name with its count: "Saved 12". */
export const tabName = (name: string, count: number) => `${name} ${count}`
