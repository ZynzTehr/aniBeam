import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { testDatabase, type TestDatabase } from '../testing/database.ts'
import * as schema from './schema.ts'

// The drift check: schema.ts describes the tables by hand, so this compares it with the tables the
// migrations really made. Each column's type, null rule, identity and default, and each
// constraint and index, by name (with the columns of each unique constraint and foreign key).

let db: TestDatabase
before(async () => {
  db = await testDatabase()
})
after(() => db?.close())

const tables: PgTable[] = [schema.users, schema.messages, schema.reports]

/** What schema.ts says a table is. */
function described(table: PgTable) {
  const config = getTableConfig(table)
  const keys = config.foreignKeys.map((key) => {
    const { columns, foreignColumns, foreignTable } = key.reference()
    const names = (list: typeof columns) => list.map((column) => column.name).join(', ')
    const to = getTableConfig(foreignTable).name
    return `${key.getName()}: FOREIGN KEY (${names(columns)}) REFERENCES ${to}(${names(foreignColumns)})`
  })
  const uniques = [
    ...config.columns
      .filter((column) => column.isUnique)
      .map((column) => `${column.uniqueName}: UNIQUE (${column.name})`),
    ...config.uniqueConstraints.map(
      (unique) => `${unique.getName()}: UNIQUE (${unique.columns.map((c) => c.name).join(', ')})`,
    ),
  ]
  return {
    columns: config.columns
      .map((column) => ({
        name: column.name,
        type: column.getSQLType(),
        notNull: column.notNull,
        primary: column.primary,
        identity: column.generatedIdentity?.type ?? null,
        default: column.hasDefault && !column.generatedIdentity,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    constraints: [
      ...keys,
      ...uniques,
      ...config.checks.map((check) => `${check.name}: CHECK`),
    ].sort(),
    indexes: config.indexes.map((index) => index.config.name).sort(),
  }
}

/** What the database says a table is. */
async function real(name: string) {
  const { rows: columns } = await db.pool.query(
    `select column_name as name, data_type as type, is_nullable = 'NO' as "notNull",
       exists (select from pg_constraint p, pg_attribute a
         where p.conrelid = $1::text::regclass and p.contype = 'p' and a.attrelid = p.conrelid
           and a.attnum = any (p.conkey) and a.attname = column_name) as primary,
       lower(identity_generation) as identity, column_default is not null as default
     from information_schema.columns where table_schema = 'public' and table_name = $1::text`,
    [name],
  )
  // Not-null constraints (contype n) are compared with the columns, and the primary key above.
  const { rows: constraints } = await db.pool.query<{ name: string; def: string }>(
    `select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = $1::regclass and contype in ('f', 'u', 'c')`,
    [name],
  )
  // The indexes of its own, not the ones that hold a constraint up.
  const { rows: indexes } = await db.pool.query<{ name: string }>(
    `select indexrelid::regclass::text as name from pg_index
     where indrelid = $1::regclass and not exists (select from pg_constraint where conindid = indexrelid)`,
    [name],
  )
  return {
    columns: columns.sort((a, b) => a.name.localeCompare(b.name)),
    constraints: constraints
      .map(({ name, def }) => `${name}: ${def.startsWith('CHECK') ? 'CHECK' : def}`)
      .sort(),
    indexes: indexes.map((index) => index.name).sort(),
  }
}

test('schema.ts describes every table the migrations make', async () => {
  const { rows } = await db.pool.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'",
  )
  assert.deepEqual(
    rows.map((row) => row.name).sort(),
    tables.map((table) => getTableConfig(table).name).sort(),
  )
})

for (const table of tables) {
  const name = getTableConfig(table).name
  test(`schema.ts matches the real ${name} table`, async () => {
    assert.deepEqual(described(table), await real(name))
  })
}
