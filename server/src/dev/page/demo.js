// The two-tab demo's script, served at /demo/demo.js (../page.ts) under a CSP that runs scripts
// from files on this server alone. `io` is Socket.IO's browser file, loaded before it. Each
// message goes on the page with textContent, never as HTML, so a body such as
// <img src=x onerror=...> shows as the text it is.
'use strict'

/** The most code points a message may have, counted as the server counts them. */
const MAX = 500

const $ = (id) => document.getElementById(id)

/** The dev sign-in's token, dev:<name>, or undefined while signed out. */
let token
/** The room this page is in, or undefined before the first join. */
let room
/** The room's messages by id, from history and live alike, so that one shows once. */
const shown = new Map()
/**
 * The ids of messages reports have hidden, so that a history read begun before the hide, or the
 * message coming live as well, never brings one back.
 */
const gone = new Set()
/** The ids of messages this page has reported. */
const reported = new Set()

// auth is a function, so that each connect, a reconnect too, sends the token of the moment.
// WebSocket alone, never polling: a browser sends no Origin with a GET to its page's own server,
// which polling's first request is, and the server refuses a request without one. A WebSocket
// always has it. Nothing is sent again on its own: a send that gets no answer says so, and is
// left to the user.
const socket = io({
  transports: ['websocket'],
  auth: (send) => send(token === undefined ? {} : { token }),
})

function say(id, text) {
  $(id).textContent = text
}

/** Shows `shown` oldest first, newest last, as text alone. */
function render() {
  const items = [...shown.values()]
    .sort((a, b) => a.id - b.id)
    .map((message) => {
      const item = document.createElement('li')
      const time = document.createElement('span')
      time.className = 'time'
      time.textContent = new Date(message.createdAt).toLocaleTimeString()
      const handle = document.createElement('span')
      handle.className = 'handle'
      handle.textContent = message.handle
      const body = document.createElement('span')
      body.textContent = message.body
      if (message.spoiler) {
        // Blurred until clicked, as the spec has spoilers.
        body.className = 'spoiler'
        body.title = 'Spoiler: click to show'
        body.addEventListener('click', () => body.classList.remove('spoiler'), { once: true })
      }
      const report = document.createElement('button')
      report.type = 'button'
      report.className = 'report'
      report.textContent = reported.has(message.id) ? 'Reported' : 'Report'
      report.disabled = reported.has(message.id)
      report.addEventListener('click', () => reportMessage(message.id))
      item.append(time, handle, body, report)
      return item
    })
  $('messages').replaceChildren(...items)
}

/** Adds messages of this page's room, dropping any it shows already, or that reports hid. */
function add(...messages) {
  for (const message of messages)
    if (message.roomKey === room && !shown.has(message.id) && !gone.has(message.id))
      shown.set(message.id, message)
  render()
}

/** What each refusal's code means, as text, or a function of the answer that says it. */
const ERRORS = {
  invalid: 'A message is 1 to 500 characters, and a room key looks like anime:154587:ep:5.',
  'not-found': 'That message is gone: hidden already, or never there.',
  'sign-in-required': 'Sign in with a name first: signed out, you can read but not send or report.',
  'bad-token': 'the sign-in token proves nothing. Sign in again.',
  'handle-required': 'Set a handle first.',
  'not-joined': 'Join the room first.',
  'too-many-rooms': 'This socket is in too many rooms.',
  // The wait in whole seconds, rounded up, so that the next try after it is let through.
  'rate-limited': ({ retryAfterMs }) =>
    `Too many at once: wait ${Math.ceil(retryAfterMs / 1000)} s, then try again.`,
  'too-many-connections': 'this computer has too many chat tabs open. Close one, then reload.',
  'message-blocked': 'That message has a word the chat refuses. Nothing was posted.',
  'handle-blocked': 'that name has a word the chat refuses.',
  banned: 'This user is banned, so it can read but not send or report.',
  'cannot-report-own': "That message is yours: a report is for someone else's.",
  'server-error': 'The server failed, so nothing was posted or reported.',
}
/** The text for a refusal, { error } with what came with it, or its code if it has none. */
function explain(answer) {
  const text = ERRORS[answer.error]
  return typeof text === 'function' ? text(answer) : (text ?? answer.error)
}

/**
 * Joins `key`, then leaves the room before it, then reads the room's history. The join's ack
 * comes once the socket is in the room, so history read after it misses nothing sent since; a
 * message that arrives live while history loads, or is in both, shows once. The room before is
 * left only once the join is done, so that a join refused, as of a bad key, leaves the page in
 * it still, as it says.
 */
async function join(key) {
  const answer = await socket.timeout(5000).emitWithAck('join', { roomKey: key })
  if (answer.error) {
    say('error', explain(answer))
    return
  }
  const before = room
  if (before !== key) shown.clear()
  room = key
  say('error', '')
  render()
  // No answer is needed: the room's messages show no more once `room` is another (add).
  if (before !== undefined && before !== key) socket.emit('leave', { roomKey: before })
  const response = await fetch(`/rooms/${encodeURIComponent(key)}/messages`)
  const page = await response.json()
  // A join of another room meanwhile wins.
  if (room === key) add(...page.messages)
}

function status() {
  if (!socket.connected) return say('status', 'Reconnecting...')
  const where = room === undefined ? 'no room yet' : `in ${room}`
  say('status', `Connected over ${socket.io.engine.transport.name}, ${where}.`)
}

socket.on('connect', async () => {
  status()
  // After a reconnect the server has forgotten the socket's rooms: join again, and read the
  // history again, for what was sent while this page was away.
  if (room !== undefined) await join(room).catch((err) => say('error', err.message))
  status()
})
socket.on('disconnect', status)
socket.on('connect_error', (err) => say('status', `Refused: ${explain({ error: err.message })}`))
socket.on('message:new', (message) => add(message))
// Three people reported a message: it goes from the page, in every tab in the room.
socket.on('message:hidden', ({ id }) => {
  gone.add(id)
  shown.delete(id)
  render()
})

/**
 * Reports the message `id` for the reason in the Report reason box. The server counts one report
 * per person, and the third person's hides the message, for every tab, through message:hidden.
 */
async function reportMessage(id) {
  const reason = $('reason').value
  try {
    const answer = await socket.timeout(5000).emitWithAck('message:report', { id, reason })
    if (answer.error) return say('error', explain(answer))
    say('error', '')
    reported.add(id)
    render()
  } catch {
    say('error', 'No answer from the server in 5 s. The report may not have counted.')
  }
}

$('name-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const name = $('name').value.trim()
  token = `dev:${name}`
  // Connect again, so that the socket signs in with the new token.
  socket.disconnect().connect()
  const response = await fetch('/me/handle', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ handle: name }),
  })
  const answer = await response.json()
  if (response.ok || answer.error === 'handle-already-set') {
    const me = await (await fetch('/me', { headers: { authorization: `Bearer ${token}` } })).json()
    say('who', `Signed in as ${token}, with the handle ${me.handle}.`)
  } else if (answer.error === 'handle-taken')
    say('who', `Signed in as ${token}, but someone else has the handle ${name}.`)
  else say('who', `Signed in as ${token}, with no handle: ${explain(answer)}`)
})

$('room-form').addEventListener('submit', (event) => {
  event.preventDefault()
  join($('room').value.trim())
    .then(status)
    .catch((err) => say('error', err.message))
})

// The count the server keeps to: code points of the trimmed body, not UTF-16 units.
const count = () => [...$('body').value.trim()].length
$('body').addEventListener('input', () => say('count', `${count()} / ${MAX}`))

$('send-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (room === undefined) return say('error', explain({ error: 'not-joined' }))
  const payload = { roomKey: room, body: $('body').value, spoiler: $('spoiler').checked }
  try {
    const answer = await socket.timeout(5000).emitWithAck('message:send', payload)
    if (answer.error) return say('error', explain(answer))
    say('error', '')
    $('body').value = ''
    say('count', `0 / ${MAX}`)
    // The sender's copy comes from its ack: the server sends message:new to the others alone.
    add(answer.message)
  } catch {
    say('error', 'No answer from the server in 5 s. It was not sent again; it may have posted.')
  }
})
