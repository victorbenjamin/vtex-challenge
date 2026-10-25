import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportSummary } from '../../src/domain/import-summary.ts';
import { normalizeBrand } from '../../src/domain/brand.ts';
import { normalizeProductName } from '../../src/domain/product-name.ts';
import { MARKETPLACE_SELLER_NAME } from '../../src/domain/seller-product-entry.ts';
import { readImportFile } from '../../src/infrastructure/import-file.ts';
import { ORIGINAL_DATABASE_PATH } from '../../src/infrastructure/sqlite/connection.ts';
import {
  createMigratedDatabase,
  sqliteImportCatalog,
  type MigratedDatabase,
} from '../helpers/working-database.ts';

// Expected results come from docs/analysis/data-analysis.md §3.1 and §5, for the third
// import increment: the first three rows of §3.1 (exact names, names that differ only in
// spelling, and brand or category variants). Item #55 "Câmera" and #76 "Camera" share
// seller and Id, so #76 is already linked. The other 3 items need rules not implemented yet.

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

describe(`importing ${FILE} (name, spelling, brand and category variants)`, () => {
  it('links 265 items and leaves 3 pending', () => {
    expect(summary.counts()).toEqual({
      linked: 265,
      alreadyLinked: 1,
      conflict: 0,
      unmatched: 3,
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
    [
      'category',
      '#87 Camera Canon EOS R6 (Photo)',
      'GardenStore',
      'e6e6e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9',
      18,
    ],
    [
      'brand',
      "#188 Belt Leather Reversible (Levi's)",
      'SportsHub',
      '88990055-1122-4334-4556-677889900112',
      322,
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

  it('stores 1,240 offers: 975 from the marketplace plus 265 imported', () => {
    expect(db.prepare('SELECT COUNT(*) FROM SellerProduct').pluck().get()).toBe(1240);
  });

  it('links every imported offer to a product with the same normalized name and brand', () => {
    const items = readImportFile(FILE) as Record<string, string | null>[];
    const itemBySellerSku = new Map(
      items.map((item) => [`${item['SellerName']}|${item['Id']}`, item]),
    );
    const offers = db
      .prepare(
        `SELECT s.Name AS sellerName, sp.SellerProductId AS sku,
                p.NormalizedName AS name, p.Brand AS brand
         FROM SellerProduct sp
         JOIN Seller s ON s.Id = sp.SellerId
         JOIN Product p ON p.Id = sp.ProductId
         WHERE s.Name <> ?`,
      )
      .all(MARKETPLACE_SELLER_NAME) as Record<string, string | null>[];

    expect(offers).toHaveLength(265);
    for (const offer of offers) {
      const item = itemBySellerSku.get(`${offer['sellerName']}|${offer['sku']}`);
      expect([offer['name'], normalizeBrand(offer['brand'] ?? null)]).toEqual([
        normalizeProductName(item?.['Name'] ?? ''),
        normalizeBrand(item?.['Brand'] ?? null),
      ]);
    }
  });

  it('completes without failure', () => {
    expect(summary.failure).toBeUndefined();
  });

  it('is idempotent', () => {
    const second = sqliteImportCatalog(db).execute(readImportFile(FILE));

    expect(second.counts()).toMatchObject({ linked: 0, alreadyLinked: 266, unmatched: 3 });
  });

  it('does not create products', () => {
    expect(db.prepare('SELECT COUNT(*) FROM Product').pluck().get()).toBe(975);
  });

  it('leaves the original database untouched', () => {
    expect(sha256(ORIGINAL_DATABASE_PATH)).toBe(originalHash);
  });
});
