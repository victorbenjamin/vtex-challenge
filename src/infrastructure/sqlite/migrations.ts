import knex, { type Knex } from 'knex';
import { resolve } from 'node:path';
import { assertNotOriginal, WORKING_DATABASE_PRAGMAS } from './connection.ts';

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
        for (const pragma of WORKING_DATABASE_PRAGMAS) {
          connection.pragma(pragma);
        }
        done();
      },
    },
    migrations: { directory: MIGRATIONS_PATH, loadExtensions: ['.ts'] },
  });
}
