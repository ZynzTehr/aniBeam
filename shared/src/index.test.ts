import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as shared from '@anibeam/shared'

test('the package exports the room key schema', () => {
  assert.deepEqual(Object.keys(shared).sort(), ['roomKeySchema'])
  assert.equal(shared.roomKeySchema.safeParse('anime:1:all').success, true)
})

test('zod is imported only as zod/mini, which web can tree-shake to what it uses', () => {
  const files = globSync('src/**/*.ts')
  assert.ok(files.length > 0)
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const [, from] of text.matchAll(/(?:from\s+|import\(\s*)['"](zod[^'"]*)['"]/g))
      assert.equal(from, 'zod/mini', file)
  }
})
