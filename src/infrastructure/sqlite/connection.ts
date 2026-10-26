import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ORIGINAL_DATABASE_PATH = resolve('data/catalog.db');
export const WORKING_DATABASE_PATH = resolve('output/catalog.db');

// Settings of every connection that writes to a working copy:
// - foreign keys are enforced (SQLite leaves them off by default);
// - WAL: a commit appends to the -wal file instead of rewriting pages through a rollback
//   journal, so it waits far less for the disk (7 times faster imports, measured in
//   docs/analysis/performance-and-scale.md). With synchronous = NORMAL a power loss may drop
//   the last committed transactions but never corrupts the database; importing again redoes
//   them, since imports are idempotent. The original database is never switched to WAL:
//   that would rewrite its header.
export const WORKING_DATABASE_PRAGMAS = [
  'foreign_keys = ON',
  'journal_mode = WAL',
  'synchronous = NORMAL',
];

// The original database is the challenge input and must never be written to.
export function assertNotOriginal(path: string): void {
  if (resolve(path) === ORIGINAL_DATABASE_PATH) {
    throw new Error(`Refusing to write to the original database: ${ORIGINAL_DATABASE_PATH}`);
  }
}

export function createWorkingCopy(
  destination: string,
  source: string = ORIGINAL_DATABASE_PATH,
): void {
  assertNotOriginal(destination);
  mkdirSync(dirname(resolve(destination)), { recursive: true });
  // WAL files left by a previous working copy would be applied to the new one and corrupt it.
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${destination}${suffix}`, { force: true });
  }
  copyFileSync(source, destination);
}

export function openWorkingDatabase(path: string): Database.Database {
  assertNotOriginal(path);
  if (!existsSync(path)) {
    throw new Error(`Working database not found: ${path}`);
  }
  const db = new Database(path, { fileMustExist: true });
  for (const pragma of WORKING_DATABASE_PRAGMAS) {
    db.pragma(pragma);
  }
  return db;
}
