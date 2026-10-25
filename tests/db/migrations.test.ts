import Database from 'better-sqlite3';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkingCopy,
  openWorkingDatabase,
  ORIGINAL_DATABASE_PATH,
} from '../../src/db/connection.ts';
import { createMigrator } from '../../src/db/migrations.ts';

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

let directory: string;
let path: string;
let migrator: Knex;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'catalog-'));
  path = join(directory, 'catalog.db');
  createWorkingCopy(path);
  migrator = createMigrator(path);
});

afterEach(async () => {
  await migrator.destroy();
  rmSync(directory, { recursive: true, force: true });
});

const latest = async () => ((await migrator.migrate.latest()) as [number, string[]])[1];

// Assertions use a plain better-sqlite3 connection, like the application will.
const withDatabase = <T>(read: (db: Database.Database) => T): T => {
  const db = openWorkingDatabase(path);
  try {
    return read(db);
  } finally {
    db.close();
  }
};

const insertLegacyRows = (rows: [string, number, number][]) =>
  withDatabase((db) => {
    const insert = db.prepare(
      'INSERT INTO SellerProduct (SellerName, ProductId, SellerProductId) VALUES (?, ?, ?)',
    );
    rows.forEach((row) => insert.run(...row));
  });

describe('migrations', () => {
  it('apply to a copy and leave the original untouched', async () => {
    const originalHash = sha256(ORIGINAL_DATABASE_PATH);

    expect(await latest()).toEqual(['001_seller_and_offer_keys.ts']);
    expect(sha256(ORIGINAL_DATABASE_PATH)).toBe(originalHash);
  });

  it('are idempotent', async () => {
    await latest();

    expect(await latest()).toEqual([]);
  });

  it('keep the product catalog intact', async () => {
    await latest();

    expect(withDatabase((db) => db.prepare('SELECT COUNT(*) FROM Product').pluck().get())).toBe(
      975,
    );
  });

  it('preserve existing SellerProduct rows and create their sellers', async () => {
    insertLegacyRows([
      ['MegaStore', 2, 101],
      [' MegaStore ', 3, 102],
      ['TechWorld', 2, 201],
    ]);

    await latest();

    withDatabase((db) => {
      expect(db.prepare('SELECT Name FROM Seller ORDER BY Name').pluck().all()).toEqual([
        'MegaStore',
        'TechWorld',
      ]);
      expect(
        db
          .prepare(
            `SELECT s.Name, sp.SellerProductId, sp.ProductId
             FROM SellerProduct sp JOIN Seller s ON s.Id = sp.SellerId
             ORDER BY s.Name, sp.SellerProductId`,
          )
          .raw()
          .all(),
      ).toEqual([
        ['MegaStore', '101', 2],
        ['MegaStore', '102', 3],
        ['TechWorld', '201', 2],
      ]);
    });
  });

  it('fail atomically when legacy rows share a seller SKU', async () => {
    insertLegacyRows([
      ['MegaStore', 2, 101],
      ['MegaStore', 3, 101],
    ]);

    await expect(latest()).rejects.toThrow(/UNIQUE constraint failed/);
    withDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) FROM SellerProduct').pluck().get()).toBe(2);
      expect(
        db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'Seller'").pluck().get(),
      ).toBe(0);
    });
  });

  it('roll back to the original schema', async () => {
    const structure = () =>
      withDatabase((db) => ({
        columns: db.pragma('table_info(SellerProduct)'),
        foreignKeys: db.pragma('foreign_key_list(SellerProduct)'),
        tables: db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'knex%'")
          .pluck()
          .all(),
      }));
    const original = structure();
    await latest();

    await migrator.migrate.rollback();

    expect(structure()).toEqual(original);
  });
});

describe('schema after migrations', () => {
  let db: Database.Database;

  beforeEach(async () => {
    await latest();
    db = openWorkingDatabase(path);
  });

  afterEach(() => {
    db.close();
  });

  const insertSeller = (name: string) =>
    Number(db.prepare('INSERT INTO Seller (Name) VALUES (?)').run(name).lastInsertRowid);

  const insertOffer = (sellerId: number, sellerProductId: string, productId: number) =>
    db
      .prepare('INSERT INTO SellerProduct (SellerId, SellerProductId, ProductId) VALUES (?, ?, ?)')
      .run(sellerId, sellerProductId, productId);

  it('allows several SKUs of the same seller for the same product', () => {
    const seller = insertSeller('OfficeSupply');
    insertOffer(seller, '1111aaaa-2222-4bbb-cccc-3333ddddeeee', 781);
    insertOffer(seller, 'aaaa1111-bbbb-4222-cccc-dddd33334444', 781);

    expect(
      db.prepare('SELECT DISTINCT SellerId FROM SellerProduct WHERE ProductId = 781').all(),
    ).toHaveLength(1);
  });

  it('rejects the same SKU twice for one seller', () => {
    const seller = insertSeller('GardenStore');
    insertOffer(seller, 'e5e5e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9', 18);

    expect(() => insertOffer(seller, 'e5e5e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9', 18)).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('allows the same SKU for different sellers', () => {
    insertOffer(insertSeller('GardenStore'), '00112233-4455-4667-7889-900112233445', 1);
    insertOffer(insertSeller('SportsHub'), '00112233-4455-4667-7889-900112233445', 2);

    expect(db.prepare('SELECT COUNT(*) FROM SellerProduct').pluck().get()).toBe(2);
  });

  it('enforces foreign keys', () => {
    const seller = insertSeller('MegaStore');

    expect(() => insertOffer(seller, 'sku', 999_999)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insertOffer(999_999, 'sku', 1)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('treats seller names as unique regardless of case', () => {
    insertSeller('MegaStore');

    expect(() => insertSeller('megastore')).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects empty seller names and SKUs', () => {
    expect(() => insertSeller('   ')).toThrow(/CHECK constraint failed/);
    expect(() => insertOffer(insertSeller('MegaStore'), '  ', 1)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('indexes offers by product', () => {
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT SellerId FROM SellerProduct WHERE ProductId = ?')
      .all(1) as { detail: string }[];

    expect(plan.map((row) => row.detail).join()).toContain('IX_SellerProduct_ProductId');
  });
});

describe('connection', () => {
  it('refuses to open the original database for writing', () => {
    expect(() => openWorkingDatabase(ORIGINAL_DATABASE_PATH)).toThrow(/original database/);
    expect(() => createWorkingCopy(ORIGINAL_DATABASE_PATH)).toThrow(/original database/);
  });

  it('refuses to migrate the original database', () => {
    expect(() => createMigrator(ORIGINAL_DATABASE_PATH)).toThrow(/original database/);
  });
});
