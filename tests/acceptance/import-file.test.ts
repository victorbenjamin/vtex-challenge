import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportSummary } from '../../src/domain/import-summary.ts';
import { MARKETPLACE_SELLER_NAME } from '../../src/domain/seller-product-entry.ts';
import { readImportFile } from '../../src/infrastructure/import-file.ts';
import { ORIGINAL_DATABASE_PATH } from '../../src/infrastructure/sqlite/connection.ts';
import {
  createMigratedDatabase,
  sqliteImportCatalog,
  type MigratedDatabase,
} from '../helpers/working-database.ts';

// Expected results come from docs/analysis/data-analysis.md §3.1 (first row: 200 exact
// matches) for the first import increment, which only resolves exact matches.

const FILE = 'data/ProductEntry.json';
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

let migrated: MigratedDatabase;
let db: Database.Database;
let summary: ImportSummary;
let originalHash: string;

beforeAll(async () => {
  originalHash = sha256(ORIGINAL_DATABASE_PATH);
  migrated = await createMigratedDatabase();
  db = migrated.db;
  summary = sqliteImportCatalog(db).execute(readImportFile(FILE));
});

afterAll(() => {
  migrated.cleanup();
});

describe(`importing ${FILE} (exact matches only)`, () => {
  it('links the 200 exact matches and leaves the other 69 pending', () => {
    expect(summary.counts()).toEqual({
      linked: 200,
      alreadyLinked: 0,
      conflict: 0,
      unmatched: 69,
      rejected: 0,
    });
  });

  it('creates the 20 sellers of the file', () => {
    expect(
      db
        .prepare('SELECT COUNT(*) FROM Seller WHERE Name <> ?')
        .pluck()
        .get(MARKETPLACE_SELLER_NAME),
    ).toBe(20);
  });

  it('stores 1,175 offers: 975 from the marketplace plus 200 imported', () => {
    expect(db.prepare('SELECT COUNT(*) FROM SellerProduct').pluck().get()).toBe(1175);
  });

  it('links every imported offer to a product with identical name, brand and category', () => {
    const items = readImportFile(FILE) as Record<string, string | null>[];
    const itemBySellerSku = new Map(
      items.map((item) => [`${item['SellerName']}|${item['Id']}`, item]),
    );
    const offers = db
      .prepare(
        `SELECT s.Name AS sellerName, sp.SellerProductId AS sku,
                p.Name AS name, p.Brand AS brand, p.Category AS category
         FROM SellerProduct sp
         JOIN Seller s ON s.Id = sp.SellerId
         JOIN Product p ON p.Id = sp.ProductId
         WHERE s.Name <> ?`,
      )
      .all(MARKETPLACE_SELLER_NAME) as Record<string, string | null>[];

    expect(offers).toHaveLength(200);
    for (const offer of offers) {
      const item = itemBySellerSku.get(`${offer['sellerName']}|${offer['sku']}`);
      expect([offer['name'], offer['brand'], offer['category']]).toEqual([
        item?.['Name'],
        item?.['Brand'],
        item?.['Category'],
      ]);
    }
  });

  it('completes without failure', () => {
    expect(summary.failure).toBeUndefined();
  });

  it('is idempotent', () => {
    const second = sqliteImportCatalog(db).execute(readImportFile(FILE));

    expect(second.counts()).toMatchObject({ linked: 0, alreadyLinked: 200, unmatched: 69 });
  });

  it('does not create products', () => {
    expect(db.prepare('SELECT COUNT(*) FROM Product').pluck().get()).toBe(975);
  });

  it('leaves the original database untouched', () => {
    expect(sha256(ORIGINAL_DATABASE_PATH)).toBe(originalHash);
  });
});
