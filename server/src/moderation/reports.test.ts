import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type pg from 'pg'
import { testDatabase, type TestDatabase } from '../testing/database.ts'
import { HIDE_AT, report } from './reports.ts'

// The report transaction itself, on a database of this file's own, where nothing else runs.

const ROOM = 'anime:154587:ep:5'
const REPORTERS = ['uid-rei', 'uid-kiri', 'uid-hoshi']

let db: TestDatabase
before(async () => {
  db = await testDatabase()
  await db.pool.query(
    `insert into users (auth_uid, handle) values ('uid-aki', 'aki'), ('uid-rei', 'rei'),
       ('uid-kiri', 'kiri'), ('uid-hoshi', 'hoshi')`,
  )
})
after(() => db?.close())

/** A new message of aki's, committed, and its id. */
async function posted(pool: pg.Pool, body: string) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into messages (room_key, user_id, body)
       select $1, id, $2 from users where auth_uid = 'uid-aki' returning id`,
    [ROOM, body],
  )
  return Number(rows[0].id)
}

test(`${HIDE_AT} reporters at the same moment hide the message every time, and exactly one of them says it hid it`, async (t) => {
  const { pool } = db
  // Each report is a transaction of its own, on a connection of the pool's own: three
  // connections, opened before the rounds start, so that the three reports of a round run at once.
  const opened = await Promise.all(REPORTERS.map(() => pool.connect()))
  for (const connection of opened) connection.release()
  assert.ok(pool.totalCount >= REPORTERS.length)
  const ROUNDS = 50
  const missed: number[] = []
  const started = performance.now()
  for (let round = 1; round <= ROUNDS; round++) {
    const id = await posted(pool, `round ${round}`)
    const answers = await Promise.all(
      REPORTERS.map((uid) => report(pool, uid, { id, reason: 'spam' })),
    )
    const said = answers.filter((answer) => typeof answer !== 'string' && answer.hidden)
    const { rows } = await pool.query<{ hidden: boolean; reports: number }>(
      `select hidden_at is not null as hidden,
         (select count(*)::int from reports where message_id = $1) as reports
       from messages where id = $1`,
      [id],
    )
    if (!rows[0].hidden) missed.push(round)
    assert.equal(rows[0].reports, HIDE_AT, `round ${round}`)
    // Exactly one transaction set hidden_at, so the room is told once.
    assert.equal(said.length, rows[0].hidden ? 1 : 0, `round ${round}`)
    if (said.length === 1)
      assert.deepEqual(said[0], { hidden: { id, roomKey: ROOM } }, `round ${round}`)
  }
  const took = performance.now() - started
  t.diagnostic(`${ROUNDS} rounds took ${took.toFixed(0)} ms`)
  assert.deepEqual(missed, [], `${missed.length} of ${ROUNDS} rounds left the message showing`)
  assert.ok(took < 10_000, `${ROUNDS} rounds took ${took} ms`)
})
