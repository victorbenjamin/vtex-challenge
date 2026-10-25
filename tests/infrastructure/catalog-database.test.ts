import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Offer } from '../../src/domain/offer.ts';
import { SellerProductEntry } from '../../src/domain/seller-product-entry.ts';
import { CatalogDatabase } from '../../src/infrastructure/sqlite/catalog-database.ts';
import { createMigratedDatabase, type MigratedDatabase } from '../helpers/working-database.ts';

let migrated: MigratedDatabase;
let db: Database.Database;
let catalog: CatalogDatabase;

beforeEach(async () => {
  migrated = await createMigratedDatabase();
  db = migrated.db;
  catalog = new CatalogDatabase(db);
});

afterEach(() => {
  migrated.cleanup();
});

const entry = (Name: string, Brand: string | null, Category: string | null) => {
  const parsed = SellerProductEntry.parse({
    Id: 'sku',
    SellerName: 'MegaStore',
    Name,
    Brand,
    Category,
  });
  if (!parsed) {
    throw new Error('invalid test entry');
  }
  return parsed;
};

describe('CatalogDatabase.findOrCreateSeller', () => {
  const countSellers = (name: string) =>
    db.prepare('SELECT COUNT(*) FROM Seller WHERE Name = ?').pluck().get(name);

  it('creates a seller and returns its id', () => {
    const id = catalog.findOrCreateSeller('MegaStore');

    expect(db.prepare('SELECT Name FROM Seller WHERE Id = ?').pluck().get(id)).toBe('MegaStore');
  });

  it('returns the existing seller regardless of case, without creating another', () => {
    const id = catalog.findOrCreateSeller('MegaStore');

    expect(catalog.findOrCreateSeller('megastore')).toBe(id);
    expect(countSellers('MegaStore')).toBe(1);
  });

  it('stores seller-provided text literally', () => {
    const name = "O'Reilly'; DROP TABLE Product; --";
    const id = catalog.findOrCreateSeller(name);

    expect(db.prepare('SELECT Name FROM Seller WHERE Id = ?').pluck().get(id)).toBe(name);
    expect(db.prepare('SELECT COUNT(*) FROM Product').pluck().get()).toBe(975);
  });
});

describe('CatalogDatabase.addOfferIfAbsent', () => {
  let sellerId: number;
  beforeEach(() => {
    sellerId = catalog.findOrCreateSeller('MegaStore');
  });

  const storedOffers = () =>
    db
      .prepare('SELECT SellerProductId, ProductId FROM SellerProduct WHERE SellerId = ?')
      .raw()
      .all(sellerId);

  it('stores a new offer and returns undefined', () => {
    expect(catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 2))).toBeUndefined();
    expect(storedOffers()).toEqual([['sku-1', 2]]);
  });

  it('keeps the existing offer for the same SKU and returns its product', () => {
    catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 2));

    expect(catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 3))).toBe(2);
    expect(storedOffers()).toEqual([['sku-1', 2]]);
  });

  it('stores several SKUs of the seller for the same product', () => {
    catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 2));
    catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-2', 2));

    expect(storedOffers()).toEqual([
      ['sku-1', 2],
      ['sku-2', 2],
    ]);
  });

  it('enforces foreign keys', () => {
    expect(() => catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 999_999))).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe('CatalogDatabase.transaction', () => {
  it('rolls back everything when the work throws', () => {
    expect(() =>
      catalog.transaction(() => {
        catalog.findOrCreateSeller('MegaStore');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare("SELECT COUNT(*) FROM Seller WHERE Name = 'MegaStore'").pluck().get()).toBe(
      0,
    );
  });
});

describe('CatalogDatabase.findProductIdsByNormalizedName', () => {
  const find = (attributes: SellerProductEntry) =>
    catalog.findProductIdsByNormalizedName(attributes, 2);

  it.each([
    ['the exact name', entry('Smartphone Galaxy S23', 'Samsung', 'Electronics'), [2]],
    ['a double space', entry('Smartphone  Galaxy S23', 'Samsung', 'Electronics'), [2]],
    ['other case', entry('smartphone galaxy s23', 'Samsung', 'Electronics'), [2]],
    ['an accent', entry('Câmera Canon EOS R6', 'Canon', 'Photography'), [18]],
    ['two single quotes as inches', entry("Tablet iPad Pro 12.9''", 'Apple', 'Tablets'), [14]],
    ['a missing inch mark', entry('Smart TV Samsung 55', 'Samsung', 'Electronics'), [10]],
    ['a null brand', entry('Cable  Organizer Kit', null, 'Accessories'), [113]],
    ['null brand and category', entry('Crepe Maker', null, null), [81]],
  ])('finds the product given %s', (_, attributes, ids) => {
    expect(find(attributes)).toEqual(ids);
  });

  it.each([
    ['brand variant', entry('Belt Leather Reversible', "Levi's", 'Accessories')],
    ['category variant', entry('Camera Canon EOS R6', 'Canon', 'Photo')],
    ['translation', entry('Roteador WiFi 6 TP-Link', 'TP-Link', 'Networking')],
    ['null spelled as text', entry('Cable Organizer Kit', 'null', 'Accessories')],
  ])('finds nothing for a %s', (_, attributes) => {
    expect(find(attributes)).toEqual([]);
  });

  it('respects the limit', () => {
    const insert = db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    );
    for (let i = 0; i < 3; i++) {
      insert.run('Limit Probe', null, null, 'limit probe');
    }

    expect(find(entry('Limit Probe', null, null))).toHaveLength(2);
  });

  it('is served by the normalized-name index instead of a table scan', () => {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT Id FROM Product WHERE NormalizedName = ? AND Brand IS ? AND Category IS ? LIMIT ?',
      )
      .all('x', null, null, 2) as { detail: string }[];

    expect(plan.map(({ detail }) => detail).join()).toContain(
      'IX_Product_NormalizedName_Brand_Category',
    );
  });
});
