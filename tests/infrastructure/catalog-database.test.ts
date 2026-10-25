import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Offer } from '../../src/domain/offer.ts';
import { normalizeProductName } from '../../src/domain/product-name.ts';
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

describe('CatalogDatabase.findProductsByNormalizedName', () => {
  const find = (name: string) =>
    catalog.findProductsByNormalizedName(normalizeProductName(name), 50);

  it.each([
    ['the exact name', 'Smartphone Galaxy S23', [{ id: 2, brand: 'Samsung' }]],
    ['a double space', 'Smartphone  Galaxy S23', [{ id: 2, brand: 'Samsung' }]],
    ['an accent', 'Câmera Canon EOS R6', [{ id: 18, brand: 'Canon' }]],
    ['two single quotes as inches', "Tablet iPad Pro 12.9''", [{ id: 14, brand: 'Apple' }]],
    ['a missing inch mark', 'Smart TV Samsung 55', [{ id: 10, brand: 'Samsung' }]],
    ['a product without brand', 'Cable  Organizer Kit', [{ id: 113, brand: null }]],
  ])('finds the product and its brand given %s', (_, name, products) => {
    expect(find(name)).toEqual(products);
  });

  it('finds nothing for a translated name', () => {
    expect(find('Roteador WiFi 6 TP-Link')).toEqual([]);
  });

  it('returns every product with the name, whatever its brand and category', () => {
    db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    ).run('Smartphone Galaxy S23', 'Other Brand', 'Toys', 'smartphone galaxy s23');

    expect(
      find('Smartphone Galaxy S23')
        .map(({ brand }) => brand)
        .sort(),
    ).toEqual(['Other Brand', 'Samsung']);
  });

  it('respects the limit', () => {
    const insert = db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    );
    for (let i = 0; i < 3; i++) {
      insert.run('Limit Probe', null, null, 'limit probe');
    }

    expect(catalog.findProductsByNormalizedName('limit probe', 2)).toHaveLength(2);
  });

  it('is served by the normalized-name index instead of a table scan', () => {
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT Id AS id, Brand AS brand FROM Product WHERE NormalizedName = ? LIMIT ?',
      )
      .all('x', 2) as { detail: string }[];

    expect(plan.map(({ detail }) => detail).join()).toContain(
      'IX_Product_NormalizedName_Brand_Category',
    );
  });
});

describe('CatalogDatabase.loadNameSynonyms', () => {
  it('loads the synonyms of the database', () => {
    expect(catalog.loadNameSynonyms().translate('roteador wifi 6 tp-link')).toBe(
      'router wifi 6 tp-link',
    );
  });

  it('sees synonyms added to the table, with no migration', () => {
    db.prepare('INSERT INTO NameSynonym (Term, Replacement) VALUES (?, ?)').run(
      'teclado',
      'keyboard',
    );

    expect(catalog.loadNameSynonyms().translate('teclado mecanico rgb')).toBe(
      'keyboard mecanico rgb',
    );
  });
});
