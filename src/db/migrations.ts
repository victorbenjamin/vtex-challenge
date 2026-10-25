import knex, { type Knex } from 'knex';
import { resolve } from 'node:path';
import { assertNotOriginal } from './connection.ts';

export const MIGRATIONS_PATH = resolve('migrations');

// Knex tracks applied migrations in the knex_migrations table and runs each one
// in a transaction. The original database is refused: migrations only run on copies.
export function createMigrator(databasePath: string): Knex {
  assertNotOriginal(databasePath);
  return knex({
    client: 'better-sqlite3',
    connection: { filename: databasePath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (connection: { pragma: (sql: string) => void }, done: () => void) => {
        connection.pragma('foreign_keys = ON');
        done();
      },
    },
    migrations: { directory: MIGRATIONS_PATH, loadExtensions: ['.ts'] },
  });
}
