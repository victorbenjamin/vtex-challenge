import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ORIGINAL_DATABASE_PATH = resolve('data/catalog.db');
export const WORKING_DATABASE_PATH = resolve('output/catalog.db');

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
  copyFileSync(source, destination);
}

export function openWorkingDatabase(path: string): Database.Database {
  assertNotOriginal(path);
  if (!existsSync(path)) {
    throw new Error(`Working database not found: ${path}`);
  }
  const db = new Database(path, { fileMustExist: true });
  db.pragma('foreign_keys = ON');
  return db;
}
