import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildApp } from './app.ts'

test('GET /health answers ok', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true })
})
