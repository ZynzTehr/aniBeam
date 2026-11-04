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
      item.append(time, handle, body)
      return item
    })
  $('messages').replaceChildren(...items)
}

/** Adds messages of this page's room, dropping any it shows already. */
function add(...messages) {
  for (const message of messages)
    if (message.roomKey === room && !shown.has(message.id)) shown.set(message.id, message)
  render()
}

const ERRORS = {
  invalid: 'A message is 1 to 500 characters, and a room key looks like anime:154587:ep:5.',
  'sign-in-required': 'Sign in with a name first: signed out, you can read but not send.',
  'handle-required': 'Set a handle first.',
  'not-joined': 'Join the room first.',
  'too-many-rooms': 'This socket is in too many rooms.',
  'server-error': 'The server failed to save it. Nothing was posted.',
}
const explain = (code) => ERRORS[code] ?? code

/**
 * Joins `key`, leaving the room before it, then reads the room's history. The join's ack comes
 * once the socket is in the room, so history read after it misses nothing sent since; a message
 * that arrives live while history loads, or is in both, shows once.
 */
async function join(key) {
  if (room !== undefined && room !== key)
    await socket.timeout(5000).emitWithAck('leave', { roomKey: room })
  const answer = await socket.timeout(5000).emitWithAck('join', { roomKey: key })
  if (answer.error) {
    say('error', explain(answer.error))
    return
  }
  if (room !== key) shown.clear()
  room = key
  say('error', '')
  render()
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
socket.on('connect_error', (err) => say('status', `Refused: ${err.message}.`))
socket.on('message:new', (message) => add(message))

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
  else say('who', `Signed in as ${token}, with no handle: ${explain(answer.error)}`)
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
  if (room === undefined) return say('error', explain('not-joined'))
  const payload = { roomKey: room, body: $('body').value, spoiler: $('spoiler').checked }
  try {
    const answer = await socket.timeout(5000).emitWithAck('message:send', payload)
    if (answer.error) return say('error', explain(answer.error))
    say('error', '')
    $('body').value = ''
    say('count', `0 / ${MAX}`)
    // The sender's copy comes from its ack: the server sends message:new to the others alone.
    add(answer.message)
  } catch {
    say('error', 'No answer from the server in 5 s. It was not sent again; it may have posted.')
  }
})
