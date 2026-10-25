import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('environment', () => {
  it('reads the original catalog database without modifying it', () => {
    const db = new Database('data/catalog.db', { readonly: true, fileMustExist: true });
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM Product').get() as {
      count: number;
    };
    db.close();

    expect(count).toBe(975);
  });
});
