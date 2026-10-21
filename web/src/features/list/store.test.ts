// The list store (store.ts): the one piece of code that reads and writes My List in the browser's
// localStorage, under anibeam:list:v1 (spec §3F).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CAP,
  createListStore,
  KEY,
  listedIn,
  merge,
  parse,
  pressStatusIn,
  setStatusIn,
  toggleFavoriteIn,
  type Entry,
  type List,
  type Status,
} from './store.ts'

const T = Date.UTC(2026, 9, 21, 12)

test('a saved list comes back as it was written', () => {
  const list = {
    '1': { status: 'SAVED', favorite: false, updatedAt: T },
    '21': { status: 'WANT', favorite: true, updatedAt: T + 1 },
    '154587': { status: 'SAVED', favorite: false, updatedAt: T + 2, deleted: true },
    '999999999': { status: 'WANT', favorite: false, updatedAt: 0 },
  }
  assert.deepEqual(parse(JSON.stringify(list)), list, 'the list read back')
})

test('one bad entry is dropped on its own, and the good ones beside it are kept', () => {
  const good = { status: 'SAVED', favorite: true, updatedAt: T }
  const list = parse(
    JSON.stringify({
      '1': good,
      // Ids as route.ts reads them: 1 to 9 digits, with no leading zero.
      '0': good,
      '021': good,
      '1000000000': good,
      '-5': good,
      '1e5': good,
      abc: good,
      ['__proto__']: good,
      // Each field, wrong in one way.
      '2': { ...good, status: 'COMPLETED' },
      '3': { ...good, status: 'saved' },
      '4': { favorite: true, updatedAt: T },
      '5': { ...good, favorite: 'yes' },
      '6': { ...good, favorite: 1 },
      '7': { ...good, updatedAt: '1760000000000' },
      '8': { ...good, updatedAt: null },
      '9': { ...good, updatedAt: -1 },
      '10': { ...good, updatedAt: T + 0.5 },
      '11': { ...good, updatedAt: 2 ** 53 },
      '12': { ...good, deleted: false },
      '13': { ...good, deleted: 'true' },
      '14': { ...good, deleted: null },
      '15': null,
      '16': 'SAVED',
      '17': [good],
      '18': good,
    }),
  )
  assert.deepEqual(list, { '1': good, '18': good }, 'only the two good entries are kept')
})

test('a field the list never writes is left out, and the entry kept', () => {
  // Only ids and statuses are kept (spec §5): a title's name, say, never comes back.
  assert.deepEqual(
    parse(
      JSON.stringify({
        '21': { status: 'WANT', favorite: false, updatedAt: T, title: 'One Piece', note: 1 },
      }),
    ),
    { '21': { status: 'WANT', favorite: false, updatedAt: T } },
    'the entry, with only the fields an entry has',
  )
})

test('nothing saved, broken JSON or a list of the wrong shape gives an empty list, never an error', () => {
  for (const raw of [
    null,
    '',
    '{',
    '{"1": {"status": "SAVED",',
    'undefined',
    'null',
    'true',
    '42',
    '"SAVED"',
    '[]',
    '[{"status": "SAVED", "favorite": false, "updatedAt": 1}]',
  ])
    assert.deepEqual(parse(raw), {}, `reading ${raw}`)
})

const saved = (updatedAt: number, favorite = false): Entry => ({
  status: 'SAVED',
  favorite,
  updatedAt,
})
const want = (updatedAt: number, favorite = false): Entry => ({
  status: 'WANT',
  favorite,
  updatedAt,
})
const removed = (updatedAt: number, status: Status = 'SAVED'): Entry => ({
  status,
  favorite: false,
  updatedAt,
  deleted: true,
})

// Random numbers from a seed, the same each run (mulberry32), so a failure can be run again.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A random list over a few ids and a few moments, so that copies share titles and tie often.
function randomList(random: () => number): List {
  const list: List = {}
  for (let id = 1; id <= 6; id++) {
    if (random() < 0.3) continue
    const updatedAt = T + Math.floor(random() * 3)
    const status = random() < 0.5 ? 'SAVED' : 'WANT'
    list[id] =
      random() < 0.3
        ? { status, favorite: random() < 0.5, updatedAt, deleted: true }
        : { status, favorite: random() < 0.5, updatedAt }
  }
  return list
}

test('two copies merge to the same list in either order, in any grouping, and when merged again', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = seeded(seed)
    const [a, b, c] = [randomList(random), randomList(random), randomList(random)]
    const copies = JSON.stringify([a, b, c])
    const ab = merge(a, b)
    assert.deepEqual(ab, merge(b, a), `seed ${seed}: in either order`)
    assert.deepEqual(merge(ab, c), merge(a, merge(b, c)), `seed ${seed}: in any grouping`)
    assert.deepEqual(merge(a, a), a, `seed ${seed}: with itself`)
    assert.deepEqual(merge(ab, b), ab, `seed ${seed}: merged again`)
    assert.equal(JSON.stringify([a, b, c]), copies, `seed ${seed}: a copy was changed`)
  }
})

test('the later change to a title wins, and a title in one copy only is kept', () => {
  const merged = merge(
    { '1': saved(T), '2': want(T + 5), '3': saved(T) },
    { '1': want(T + 1, true), '2': saved(T + 4), '4': want(T) },
  )
  assert.deepEqual(merged, {
    '1': want(T + 1, true),
    '2': want(T + 5),
    '3': saved(T),
    '4': want(T),
  })
})

test('made at the same moment, a delete marker wins, then Saved, then the heart', () => {
  const ties: [winner: Entry, loser: Entry][] = [
    [removed(T), saved(T, true)],
    [removed(T, 'WANT'), saved(T)],
    [removed(T, 'SAVED'), removed(T, 'WANT')],
    [saved(T), want(T, true)],
    [saved(T, true), saved(T)],
    [want(T, true), want(T)],
  ]
  for (const [wins, loses] of ties) {
    const name = `${JSON.stringify(wins)} over ${JSON.stringify(loses)}`
    assert.deepEqual(merge({ '1': wins }, { '1': loses }), { '1': wins }, name)
    assert.deepEqual(merge({ '1': loses }, { '1': wins }), { '1': wins }, name)
  }
})

test("an older copy can't bring back a removed title, and delete markers are kept", () => {
  // Removed in this tab; another tab, or a copy from before, still has it.
  const here = { '1': removed(T + 10), '2': saved(T) }
  const older = { '1': saved(T + 9, true), '3': removed(T) }
  for (const merged of [merge(here, older), merge(older, here)])
    assert.deepEqual(merged, { '1': removed(T + 10), '2': saved(T), '3': removed(T) })
  // Saved again after the removal, it comes back.
  assert.deepEqual(merge(here, { '1': want(T + 11) }), { '1': want(T + 11), '2': saved(T) })
})

const HOUR = 60 * 60 * 1000

test('a change never goes back in time, even when the clock does', () => {
  // Saved at T, then the clock is set back an hour: each later change comes 1 ms after the last.
  let { list } = setStatusIn({}, 1, 'SAVED', T)
  assert.deepEqual(list, { '1': saved(T) })
  ;({ list } = toggleFavoriteIn(list, 1, T - HOUR))
  assert.deepEqual(list, { '1': saved(T + 1, true) }, 'the heart, after the clock went back')
  ;({ list } = pressStatusIn(list, 1, 'WANT', T - HOUR))
  assert.deepEqual(list, { '1': want(T + 2, true) }, 'the move, after the clock went back')
  ;({ list } = setStatusIn(list, 1, null, T - HOUR))
  assert.deepEqual(list, { '1': removed(T + 3, 'WANT') }, 'the removal, after the clock went back')
  ;({ list } = setStatusIn(list, 1, 'SAVED', T - HOUR))
  assert.deepEqual(list, { '1': saved(T + 4) }, 'saved again after its removal')
  // With the clock right again, a change takes its time.
  ;({ list } = toggleFavoriteIn(list, 1, T + HOUR))
  assert.deepEqual(list, { '1': saved(T + HOUR, true) })
})

test('the other button moves a title, keeping its heart, and the pressed one removes it', () => {
  let edited = pressStatusIn({}, 7, 'SAVED', T)
  assert.deepEqual(edited, { list: { '7': saved(T) }, change: 'added' })
  edited = toggleFavoriteIn(edited.list, 7, T + 1)
  assert.deepEqual(edited, { list: { '7': saved(T + 1, true) }, change: 'favorited' })
  edited = pressStatusIn(edited.list, 7, 'WANT', T + 2)
  assert.deepEqual(edited, { list: { '7': want(T + 2, true) }, change: 'moved' })
  // Removing takes the heart away too: a title has one entry, and one delete marker.
  edited = pressStatusIn(edited.list, 7, 'WANT', T + 3)
  assert.deepEqual(edited, { list: { '7': removed(T + 3, 'WANT') }, change: 'removed' })
  // Back on the list, it has no heart.
  edited = pressStatusIn(edited.list, 7, 'WANT', T + 4)
  assert.deepEqual(edited, { list: { '7': want(T + 4) }, change: 'added' })
  edited = toggleFavoriteIn(toggleFavoriteIn(edited.list, 7, T + 5).list, 7, T + 6)
  assert.deepEqual(edited, { list: { '7': want(T + 6) }, change: 'unfavorited' })
})

test('the heart on a title not on the list saves it, with the heart (D2, option a)', () => {
  assert.deepEqual(toggleFavoriteIn({ '2': want(T) }, 1, T + 1), {
    list: { '1': saved(T + 1, true), '2': want(T) },
    change: 'added',
  })
  // On a title taken off the list, after its delete marker.
  assert.deepEqual(toggleFavoriteIn({ '1': removed(T + 9, 'WANT') }, 1, T), {
    list: { '1': saved(T + 10, true) },
    change: 'added',
  })
})

test('an edit that changes nothing gives back the same list, and writes no time', () => {
  const list = { '1': saved(T), '2': removed(T) }
  for (const edited of [
    setStatusIn(list, 1, 'SAVED', T + 1),
    setStatusIn(list, 2, null, T + 1),
    setStatusIn(list, 3, null, T + 1),
    // Not AniList ids: a saved copy would drop them (see parse).
    setStatusIn(list, 0, 'SAVED', T + 1),
    setStatusIn(list, 1.5, 'SAVED', T + 1),
    setStatusIn(list, -4, 'SAVED', T + 1),
    setStatusIn(list, 1e9, 'SAVED', T + 1),
    pressStatusIn(list, NaN, 'WANT', T + 1),
    toggleFavoriteIn(list, 0, T + 1),
  ]) {
    assert.equal(edited.change, 'none')
    assert.equal(edited.list, list, 'the very same list')
  }
  assert.deepEqual(list, { '1': saved(T), '2': removed(T) }, 'the list given was changed')
})

test('a full list takes no new title, but its titles can still move, lose their heart or go', () => {
  // 2,000 titles on the list, and 500 taken off, whose delete markers don't count.
  const full: List = {}
  for (let id = 1; id <= CAP; id++) full[id] = id === 1 ? saved(T, true) : want(T)
  for (let id = CAP + 1; id <= CAP + 500; id++) full[id] = removed(T)
  for (const edited of [
    setStatusIn(full, 9000, 'SAVED', T + 1),
    pressStatusIn(full, 9000, 'WANT', T + 1),
    toggleFavoriteIn(full, 9000, T + 1),
    // Nor back, once taken off.
    setStatusIn(full, CAP + 1, 'SAVED', T + 1),
  ]) {
    assert.equal(edited.change, 'full')
    assert.equal(edited.list, full, 'the very same list')
  }
  assert.equal(pressStatusIn(full, 1, 'WANT', T + 1).change, 'moved')
  assert.equal(toggleFavoriteIn(full, 1, T + 1).change, 'unfavorited')
  const fewer = setStatusIn(full, 2, null, T + 1)
  assert.equal(fewer.change, 'removed')
  // One title fewer, and there is room for one more.
  assert.equal(setStatusIn(fewer.list, 9000, 'SAVED', T + 2).change, 'added')
  // 1,999 titles and the 500 markers: the markers don't fill it.
  const room = { ...full }
  delete room[CAP]
  assert.equal(setStatusIn(room, 9000, 'SAVED', T + 1).change, 'added')
})

/**
 * localStorage, as far as the list uses it, holding `room` characters at most over all its keys,
 * as a site's storage does: a write past that throws the error a browser throws when it is full.
 */
function fakeStorage(room = Infinity) {
  const items = new Map<string, string>()
  const size = () => [...items].reduce((sum, [key, value]) => sum + key.length + value.length, 0)
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const others = size() - (items.has(key) ? key.length + items.get(key)!.length : 0)
      if (others + key.length + value.length > room)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, value)
    },
    removeItem: (key: string) => void items.delete(key),
  }
}

/** A storage every use of which throws, as a browser's can when it blocks a site's storage. */
const refusing = {
  getItem: refuse,
  setItem: refuse,
  removeItem: refuse,
}
function refuse(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

const savedList = (storage: { items: Map<string, string> }) =>
  JSON.parse(storage.items.get(KEY) ?? 'null')

test('the list is saved under anibeam:list:v1 as it changes, and read back from there', () => {
  const storage = fakeStorage()
  storage.items.set(KEY, JSON.stringify({ '21': want(T - 5) }))
  const store = createListStore({ storage, now: () => T })
  assert.deepEqual(store.getSnapshot(), { '21': want(T - 5) }, 'the list saved before')
  assert.deepEqual(store.pressStatus(154587, 'SAVED'), { change: 'added', saved: true })
  assert.deepEqual(savedList(storage), { '21': want(T - 5), '154587': saved(T) })
  assert.deepEqual(store.getSnapshot(), savedList(storage), 'the list as this tab has it')
  // Nothing else is written, and nothing changes for an edit that changes nothing.
  assert.deepEqual([...storage.items.keys()], [KEY])
  assert.deepEqual(store.setStatus(21, 'WANT'), { change: 'none', saved: true })
  assert.deepEqual(savedList(storage), { '21': want(T - 5), '154587': saved(T) })
})

test("another tab's edit since this one last read is kept, never written over", () => {
  const storage = fakeStorage()
  let time = T
  const here = createListStore({ storage, now: () => time++ })
  const there = createListStore({ storage, now: () => time++ })
  // Both tabs have read the list, still empty, before either edits it.
  assert.deepEqual([here.getSnapshot(), there.getSnapshot()], [{}, {}])
  there.setStatus(2, 'WANT')
  here.setStatus(1, 'SAVED')
  assert.deepEqual(savedList(storage), { '1': saved(T + 1), '2': want(T) }, 'both edits saved')
  assert.deepEqual(here.getSnapshot(), savedList(storage), "this tab has the other's edit too")
  // The other tab never saw title 1, yet its heart reads the saved list first: it gives title 1 the
  // heart, as it is on the list, and doesn't put it on again (see HEART_ADDS_AS).
  assert.deepEqual(there.toggleFavorite(1), { change: 'favorited', saved: true })
  // A removal in one tab isn't undone by the other's next edit.
  here.setStatus(2, null)
  there.setStatus(3, 'SAVED')
  assert.deepEqual(savedList(storage), {
    '1': saved(T + 2, true),
    '2': removed(T + 3, 'WANT'),
    '3': saved(T + 4),
  })
})

test('when storage is full, the saved AniList answers go to make room for the list, and only they', () => {
  const storage = fakeStorage(400)
  storage.items.set('anibeam:cache', 'x'.repeat(300))
  storage.items.set('anibeam:motion', 'reduce')
  const store = createListStore({ storage, now: () => T })
  store.setStatus(1, 'SAVED')
  assert.deepEqual(store.setStatus(154587, 'WANT'), { change: 'added', saved: true })
  assert.deepEqual(savedList(storage), { '1': saved(T), '154587': want(T) })
  assert.deepEqual([...storage.items.keys()].sort(), ['anibeam:list:v1', 'anibeam:motion'])
  // TanStack saves its answers again, filling the storage: the next edit makes room again.
  storage.items.set('anibeam:cache', 'x'.repeat(300))
  assert.deepEqual(store.toggleFavorite(1), { change: 'favorited', saved: true })
  assert.equal(storage.items.has('anibeam:cache'), false)
  assert.deepEqual(savedList(storage), { '1': saved(T + 1, true), '154587': want(T) })
})

test('with no room even so, an edit lasts for the visit and says so, and the list is kept', () => {
  const storage = fakeStorage(40)
  storage.items.set(KEY, JSON.stringify({ '1': saved(T) }))
  const store = createListStore({ storage, now: () => T + 1 })
  assert.deepEqual(store.setStatus(154587, 'WANT'), { change: 'added', saved: false })
  assert.deepEqual(store.getSnapshot(), { '1': saved(T), '154587': want(T + 1) })
  assert.deepEqual(savedList(storage), { '1': saved(T) }, 'the list saved before is left as it was')
  // Later edits still build on this visit's.
  assert.deepEqual(store.toggleFavorite(154587), { change: 'favorited', saved: false })
  assert.deepEqual(store.getSnapshot(), { '1': saved(T), '154587': want(T + 2, true) })
})

test('a storage refusing for any other reason leaves the saved AniList answers alone', () => {
  const storage = fakeStorage()
  storage.items.set('anibeam:cache', 'answers')
  const store = createListStore({
    storage: { ...storage, setItem: refuse },
    now: () => T,
  })
  assert.deepEqual(store.setStatus(1, 'SAVED'), { change: 'added', saved: false })
  assert.equal(storage.items.get('anibeam:cache'), 'answers')
  assert.deepEqual(store.getSnapshot(), { '1': saved(T) })
})

test('with storage blocked, the list lives for the visit, and nothing throws', () => {
  for (const storage of [undefined, refusing]) {
    const store = createListStore({ storage, now: () => T })
    assert.deepEqual(store.getSnapshot(), {})
    assert.deepEqual(store.pressStatus(1, 'SAVED'), { change: 'added', saved: false })
    assert.deepEqual(store.pressStatus(1, 'WANT'), { change: 'moved', saved: false })
    assert.deepEqual(store.toggleFavorite(2), { change: 'added', saved: false })
    // The move came 1 ms after the add, as the clock stood still.
    assert.deepEqual(store.getSnapshot(), { '1': want(T + 1), '2': saved(T, true) })
  }
})

/**
 * The page's events, as the window gives them, counting the listeners added and removed for each
 * kind; `fire` sends one, with the fields given (a storage event's key, pageshow's persisted).
 */
function fakeWindow() {
  const target = new EventTarget()
  const added: string[] = []
  const removed: string[] = []
  return {
    added,
    removed,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
      added.push(type)
      target.addEventListener(type, listener)
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
      removed.push(type)
      target.removeEventListener(type, listener)
    },
    fire: (type: string, fields: object = {}) =>
      target.dispatchEvent(Object.assign(new Event(type), fields)),
  }
}

test('the list stays the very same object between reads, until an entry in it changes', () => {
  const storage = fakeStorage()
  storage.items.set(KEY, JSON.stringify({ '1': saved(T) }))
  const events = fakeWindow()
  const store = createListStore({ storage, events, now: () => T + 1 })
  const first = store.getSnapshot()
  assert.equal(store.getSnapshot(), first, 'read again')
  // Nothing changes: an edit that changes nothing, listening (which reads the saved list again),
  // and each event that does.
  store.setStatus(1, 'SAVED')
  assert.equal(store.getSnapshot(), first, 'after an edit that changed nothing')
  const stop = store.subscribe(() => assert.fail('told of a change when nothing changed'))
  events.fire('storage', { key: KEY })
  events.fire('storage', { key: null })
  events.fire('pageshow', { persisted: true })
  events.fire('visibilitychange')
  assert.equal(store.getSnapshot(), first, 'after reading the saved list again')
  stop()
  assert.equal(listedIn(first), listedIn(first), 'its ids, worked out again')
  // A change makes a new list, and new ids.
  store.setStatus(2, 'WANT')
  assert.notEqual(store.getSnapshot(), first)
  assert.notEqual(listedIn(store.getSnapshot()), listedIn(first))
  // An entry that didn't change is the very same object, so a cover showing it needn't redraw.
  assert.equal(store.getSnapshot()['1'], first['1'])
})

test("another tab's edit reaches this tab by the page's events, and its listeners hear it once", () => {
  const storage = fakeStorage()
  const events = fakeWindow()
  let time = T
  const here = createListStore({ storage, events, now: () => time++ })
  const there = createListStore({ storage, now: () => time++ })
  let heard = 0
  here.subscribe(() => heard++)
  here.subscribe(() => heard++)
  // The storage event comes for the list's key.
  there.setStatus(1, 'SAVED')
  events.fire('storage', { key: 'anibeam:cache' })
  assert.deepEqual([here.getSnapshot(), heard], [{}, 0], 'another key changed')
  events.fire('storage', { key: KEY })
  assert.deepEqual([here.getSnapshot(), heard], [{ '1': saved(T) }, 2], 'the list changed')
  // After a clear, as by the browser's tools: this tab keeps the list, and saves it at its next
  // edit, not before, so the clear stands until then.
  storage.items.clear()
  events.fire('storage', { key: null })
  assert.deepEqual([here.getSnapshot(), heard], [{ '1': saved(T) }, 2], 'after a clear')
  assert.equal(storage.items.has(KEY), false, 'the list saved again after a clear')
  events.fire('storage', { key: KEY, newValue: null })
  assert.equal(storage.items.has(KEY), false, "the list saved again after its key's removal")
  // Back or Forward to the page from the browser's cache, which pageshow without persisted is not.
  there.setStatus(2, 'WANT')
  events.fire('pageshow', { persisted: false })
  assert.equal(heard, 2, 'a page loaded anew')
  events.fire('pageshow', { persisted: true })
  assert.deepEqual([here.getSnapshot(), heard], [{ '1': saved(T), '2': want(T + 1) }, 4])
  // The visitor coming back to the tab.
  there.toggleFavorite(2)
  events.fire('visibilitychange')
  assert.deepEqual([here.getSnapshot(), heard], [{ '1': saved(T), '2': want(T + 2, true) }, 6])
})

test("when two tabs' edits cross and one is written over, the storage event puts it back", () => {
  const storage = fakeStorage()
  const events = fakeWindow()
  let time = T
  const here = createListStore({ storage, events, now: () => time++ })
  // The other tab reads the list as it was before this tab's write, as a browser's copy of storage
  // in each tab can be for a moment: its read, merge and write crosses this tab's.
  const there = createListStore({
    storage: { ...storage, getItem: () => null },
    now: () => time++,
  })
  here.subscribe(() => {})
  here.setStatus(1, 'SAVED')
  there.setStatus(2, 'WANT')
  assert.deepEqual(savedList(storage), { '2': want(T + 1) }, "this tab's edit, written over")
  events.fire('storage', { key: KEY, newValue: storage.items.get(KEY) })
  assert.deepEqual(here.getSnapshot(), { '1': saved(T), '2': want(T + 1) })
  assert.deepEqual(savedList(storage), here.getSnapshot(), 'both edits saved again')
  const reloaded = createListStore({ storage })
  assert.deepEqual(reloaded.getSnapshot(), here.getSnapshot(), 'the list after a reload')
  // Once the saved list holds all this tab has, an event writes nothing more.
  let writes = 0
  const settled = createListStore({ storage: { ...storage, setItem: () => writes++ }, events })
  settled.subscribe(() => {})
  events.fire('storage', { key: KEY, newValue: storage.items.get(KEY) })
  assert.equal(writes, 0, 'writes of a list already saved')
})

test('an edit kept for the visit when storage was full is saved after another tab writes', () => {
  const storage = fakeStorage()
  const events = fakeWindow()
  let full = true
  const here = createListStore({
    storage: {
      ...storage,
      setItem: (key: string, value: string) => {
        if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        storage.setItem(key, value)
      },
    },
    events,
    now: () => T,
  })
  here.subscribe(() => {})
  assert.deepEqual(here.setStatus(1, 'SAVED'), { change: 'added', saved: false })
  // Room again, and another tab saves an edit of its own.
  full = false
  createListStore({ storage, now: () => T + 1 }).setStatus(2, 'WANT')
  events.fire('storage', { key: KEY, newValue: storage.items.get(KEY) })
  assert.deepEqual(savedList(storage), { '1': saved(T), '2': want(T + 1) })
})

test('the first to listen reads the saved list again, as another tab may have changed it', () => {
  const storage = fakeStorage()
  const here = createListStore({ storage, now: () => T })
  const there = createListStore({ storage, now: () => T })
  assert.deepEqual(here.getSnapshot(), {})
  there.setStatus(1, 'WANT')
  here.subscribe(() => {})
  assert.deepEqual(here.getSnapshot(), { '1': want(T) })
})

test("ten listening add one listener for each of the page's events, and the last to stop removes it", () => {
  const events = fakeWindow()
  const store = createListStore({ storage: fakeStorage(), events })
  const stops = Array.from({ length: 10 }, () => store.subscribe(() => {}))
  const kinds = ['storage', 'pageshow', 'visibilitychange']
  assert.deepEqual(events.added, kinds)
  // React subscribes, stops and subscribes again in development: still one each.
  stops[0]()
  stops[0] = store.subscribe(() => {})
  assert.deepEqual(events.added, kinds)
  for (const stop of stops.slice(1)) stop()
  // Stopping twice changes nothing.
  stops[1]()
  assert.deepEqual(events.removed, [], 'removed while one still listens')
  stops[0]()
  assert.deepEqual(events.removed, kinds)
  assert.deepEqual(events.added, kinds)
})

test('the ids on the list come most lately changed first, delete markers left out', () => {
  const list = {
    '1': saved(T),
    '2': want(T + 2),
    '3': removed(T + 5),
    '4': saved(T + 1, true),
    '5': want(T + 2),
  }
  assert.deepEqual(listedIn(list), [5, 2, 4, 1])
  assert.equal(listedIn(list), listedIn(list), 'the very same array')
})
