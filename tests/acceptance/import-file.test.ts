import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportSummary } from '../../src/domain/import-summary.ts';
import { normalizeProductName } from '../../src/domain/product-name.ts';
import { MARKETPLACE_SELLER_NAME } from '../../src/domain/seller-product-entry.ts';
import { readImportFile } from '../../src/infrastructure/import-file.ts';
import { ORIGINAL_DATABASE_PATH } from '../../src/infrastructure/sqlite/connection.ts';
import {
  createMigratedDatabase,
  sqliteImportCatalog,
  type MigratedDatabase,
} from '../helpers/working-database.ts';

// Expected results come from docs/analysis/data-analysis.md §3.1 and §5, for the second
// import increment: exact matches (first row, 200 items) plus names that differ only in
// spelling (second row, 64 items). Item #55 "Câmera" and #76 "Camera" share seller and Id,
// so #76 is already linked. The other 5 items need rules not implemented yet.

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

describe(`importing ${FILE} (exact and normalized-name matches)`, () => {
  it('links 263 items and leaves 5 pending', () => {
    expect(summary.counts()).toEqual({
      linked: 263,
      alreadyLinked: 1,
      conflict: 0,
      unmatched: 5,
      rejected: 0,
    });
  });

  it.each([
    [
      'inch quotes',
      "#53 Tablet iPad Pro 12.9''",
      'KitchenPlus',
      'c3c3c3c3-d4d4-4e5e-f6f6-a7a7a7a7a7a7',
      14,
    ],
    [
      'accent',
      '#55 Câmera Canon EOS R6',
      'GardenStore',
      'e5e5e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9',
      18,
    ],
    [
      'missing inch',
      '#267 Tablet iPad Pro 12.9',
      'GadgetZone',
      'addd0000-eeee-4111-ffff-aaaa22223333',
      14,
    ],
    [
      'missing inch',
      '#268 Smart TV Samsung 55',
      'SmartHomeStore',
      'uddd0000-eeee-4111-ffff-aaaa22223333',
      10,
    ],
  ])('links the %s case %s', (_, __, sellerName, sku, productId) => {
    expect(
      db
        .prepare(
          `SELECT sp.ProductId FROM SellerProduct sp JOIN Seller s ON s.Id = sp.SellerId
           WHERE s.Name = ? AND sp.SellerProductId = ?`,
        )
        .pluck()
        .get(sellerName, sku),
    ).toBe(productId);
  });

  it('creates the 20 sellers of the file', () => {
    expect(
      db
        .prepare('SELECT COUNT(*) FROM Seller WHERE Name <> ?')
        .pluck()
        .get(MARKETPLACE_SELLER_NAME),
    ).toBe(20);
  });

  it('stores 1,238 offers: 975 from the marketplace plus 263 imported', () => {
    expect(db.prepare('SELECT COUNT(*) FROM SellerProduct').pluck().get()).toBe(1238);
  });

  it('links every imported offer to a product with the same normalized name, brand and category', () => {
    const items = readImportFile(FILE) as Record<string, string | null>[];
    const itemBySellerSku = new Map(
      items.map((item) => [`${item['SellerName']}|${item['Id']}`, item]),
    );
    const offers = db
      .prepare(
        `SELECT s.Name AS sellerName, sp.SellerProductId AS sku,
                p.NormalizedName AS name, p.Brand AS brand, p.Category AS category
         FROM SellerProduct sp
         JOIN Seller s ON s.Id = sp.SellerId
         JOIN Product p ON p.Id = sp.ProductId
         WHERE s.Name <> ?`,
      )
      .all(MARKETPLACE_SELLER_NAME) as Record<string, string | null>[];

    expect(offers).toHaveLength(263);
    for (const offer of offers) {
      const item = itemBySellerSku.get(`${offer['sellerName']}|${offer['sku']}`);
      expect([offer['name'], offer['brand'], offer['category']]).toEqual([
        normalizeProductName(item?.['Name'] ?? ''),
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

    expect(second.counts()).toMatchObject({ linked: 0, alreadyLinked: 264, unmatched: 5 });
  });

  it('does not create products', () => {
    expect(db.prepare('SELECT COUNT(*) FROM Product').pluck().get()).toBe(975);
  });

  it('leaves the original database untouched', () => {
    expect(sha256(ORIGINAL_DATABASE_PATH)).toBe(originalHash);
  });
});
