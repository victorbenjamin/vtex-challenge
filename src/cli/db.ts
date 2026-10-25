import { existsSync } from 'node:fs';
import { createWorkingCopy, WORKING_DATABASE_PATH } from '../infrastructure/sqlite/connection.ts';
import { createMigrator } from '../infrastructure/sqlite/migrations.ts';

// Usage: tsx src/cli/db.ts [--reset]
// --reset recreates the working copy from the original before migrating.
const reset = process.argv.includes('--reset');

if (reset || !existsSync(WORKING_DATABASE_PATH)) {
  createWorkingCopy(WORKING_DATABASE_PATH);
  console.log(`Created working copy at ${WORKING_DATABASE_PATH}`);
}

const migrator = createMigrator(WORKING_DATABASE_PATH);
const [, applied] = (await migrator.migrate.latest()) as [number, string[]];
console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'No pending migrations');
await migrator.destroy();
