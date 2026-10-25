import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImportCatalog } from '../../src/application/import-catalog.ts';
import { CatalogDatabase } from '../../src/infrastructure/sqlite/catalog-database.ts';
import {
  createWorkingCopy,
  openWorkingDatabase,
} from '../../src/infrastructure/sqlite/connection.ts';
import { createMigrator } from '../../src/infrastructure/sqlite/migrations.ts';

export interface MigratedDatabase {
  db: Database.Database;
  cleanup: () => void;
}

// A fully migrated copy of the original catalog in a temporary directory: tests run
// against real SQLite, never against mocks.
export async function createMigratedDatabase(): Promise<MigratedDatabase> {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-'));
  const path = join(directory, 'catalog.db');
  createWorkingCopy(path);

  const migrator = createMigrator(path);
  await migrator.migrate.latest();
  await migrator.destroy();

  const db = openWorkingDatabase(path);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

// The import use case wired to SQLite, as the CLI does.
export function sqliteImportCatalog(db: Database.Database): ImportCatalog {
  return new ImportCatalog(new CatalogDatabase(db));
}
