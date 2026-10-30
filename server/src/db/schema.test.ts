import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { is, SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect, type IndexedColumn, type PgTable } from 'drizzle-orm/pg-core'
import type pg from 'pg'
import { testDatabase, type TestDatabase } from '../testing/database.ts'
import * as schema from './schema.ts'

// The drift check: schema.ts describes the tables by hand, so this builds the tables it describes
// in an empty database and compares them with the tables the migrations really made, as
// Postgres writes both out. That covers each column's type, null rule, identity and default, and
// each constraint and index whole: its columns or expression, order, check and actions.

const tables: PgTable[] = [schema.users, schema.messages, schema.reports]

/** The tables the migrations made. */
let real: TestDatabase
/** The tables schema.ts describes, built by this test. */
let described: TestDatabase
before(async () => {
  real = await testDatabase()
  described = await testDatabase({ template: 'template0' })
  for (const statement of build(tables)) await described.pool.query(statement)
})
after(async () => {
  await real?.close()
  await described?.close()
})

const dialect = new PgDialect()
const quote = (name: string) => dialect.escapeName(name)
const names = (columns: { name: string }[]) => columns.map((c) => quote(c.name)).join(', ')

/** A piece of schema.ts's SQL, such as a check, with its columns named as a CREATE needs them. */
function render(value: SQL) {
  const query = dialect.sqlToQuery(value, 'indexes')
  if (query.params.length > 0) throw new Error(`Write the values into the SQL: ${query.sql}`)
  return query.sql
}

/** A column's default, as SQL. */
function value(given: unknown) {
  if (is(given, SQL)) return render(given)
  if (typeof given === 'boolean' || typeof given === 'number') return String(given)
  throw new Error(`schema.test.ts can't write the default ${JSON.stringify(given)} yet`)
}

/** The statements that make the tables schema.ts describes: the tables, then their keys and indexes. */
function build(list: PgTable[]) {
  const configs = list.map(getTableConfig)
  const creates = configs.map((config) => {
    if (config.primaryKeys.length > 0)
      throw new Error("schema.test.ts can't build a primary key of more columns yet")
    const columns = config.columns.map((column) =>
      [
        quote(column.name),
        column.getSQLType(),
        column.generatedIdentity &&
          `generated ${column.generatedIdentity.type === 'always' ? 'always' : 'by default'} as identity`,
        column.primary && 'primary key',
        column.notNull && 'not null',
        column.default !== undefined && `default ${value(column.default)}`,
        column.isUnique &&
          `constraint ${quote(column.uniqueName!)} unique${column.uniqueType === 'not distinct' ? ' nulls not distinct' : ''}`,
      ]
        .filter(Boolean)
        .join(' '),
    )
    const constraints = [
      ...config.checks.map(
        (check) => `constraint ${quote(check.name)} check (${render(check.value)})`,
      ),
      ...config.uniqueConstraints.map(
        (unique) =>
          `constraint ${quote(unique.getName()!)} unique${unique.nullsNotDistinct ? ' nulls not distinct' : ''} (${names(unique.columns)})`,
      ),
    ]
    return `create table ${quote(config.name)} (${[...columns, ...constraints].join(', ')})`
  })
  const keys = configs.flatMap((config) =>
    config.foreignKeys.map((key) => {
      const { columns, foreignColumns, foreignTable } = key.reference()
      return (
        `alter table ${quote(config.name)} add constraint ${quote(key.getName())} foreign key (${names(columns)}) ` +
        `references ${quote(getTableConfig(foreignTable).name)} (${names(foreignColumns)}) ` +
        `on delete ${key.onDelete} on update ${key.onUpdate}`
      )
    }),
  )
  const indexes = configs.flatMap((config) =>
    config.indexes.map(({ config: index }) => {
      // Drizzle records nulls last even for desc(), where Postgres puts them first, so only an
      // explicit nulls first is written out, and Postgres's own place for them is kept otherwise.
      const columns = (index.columns as (SQL | IndexedColumn)[]).map((column) =>
        is(column, SQL)
          ? `(${render(column)})`
          : [
              quote(column.name!),
              column.indexConfig.opClass,
              column.indexConfig.order === 'desc' && 'desc',
              column.indexConfig.nulls === 'first' && 'nulls first',
            ]
              .filter(Boolean)
              .join(' '),
      )
      return (
        `create ${index.unique ? 'unique ' : ''}index ${quote(index.name!)} on ${index.only ? 'only ' : ''}` +
        `${quote(config.name)} using ${index.method} (${columns.join(', ')})` +
        (index.where ? ` where ${render(index.where)}` : '')
      )
    }),
  )
  return [...creates, ...keys, ...indexes]
}

/** A table as the database writes it out. */
async function catalog(pool: pg.Pool, name: string) {
  const { rows: columns } = await pool.query(
    `select column_name as name, data_type as type, is_nullable = 'NO' as "notNull",
       lower(identity_generation) as identity, column_default as default
     from information_schema.columns where table_schema = 'public' and table_name = $1::text
     order by column_name`,
    [name],
  )
  // Not-null constraints (contype n) are compared with the columns.
  const { rows: constraints } = await pool.query<{ name: string; def: string }>(
    `select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = $1::regclass and contype in ('p', 'f', 'u', 'c') order by conname`,
    [name],
  )
  // The indexes of its own, not the ones that hold a constraint up.
  const { rows: indexes } = await pool.query<{ name: string; def: string }>(
    `select indexrelid::regclass::text as name, pg_get_indexdef(indexrelid) as def from pg_index
     where indrelid = $1::regclass and not exists (select from pg_constraint where conindid = indexrelid)
     order by 1`,
    [name],
  )
  return { columns, constraints, indexes }
}

test('schema.ts describes every table the migrations make', async () => {
  const { rows } = await real.pool.query<{ name: string }>(
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
    assert.deepEqual(await catalog(described.pool, name), await catalog(real.pool, name))
  })
}
