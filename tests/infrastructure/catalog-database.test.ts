import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Offer } from '../../src/domain/offer.ts';
import { normalizeProductName } from '../../src/domain/product-name.ts';
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

describe('CatalogDatabase.createProduct', () => {
  const entry = (raw: object) => {
    const parsed = SellerProductEntry.parse({ Id: 'sku', SellerName: 'MegaStore', ...raw });
    if (!parsed) {
      throw new Error('invalid test entry');
    }
    return parsed;
  };

  it('stores the product as the seller described it, with its normalized name', () => {
    const id = catalog.createProduct(
      entry({ Name: 'Câmera  Instantânea', Brand: 'Fujifilm', Category: 'Photo' }),
    );

    expect(db.prepare('SELECT * FROM Product WHERE Id = ?').get(id)).toEqual({
      Id: id,
      Name: 'Câmera  Instantânea',
      Brand: 'Fujifilm',
      Category: 'Photo',
      NormalizedName: 'camera instantanea',
      MergedIntoId: null,
    });
  });

  it('makes the product findable by its normalized name', () => {
    const id = catalog.createProduct(entry({ Name: 'Hoverboard X1', Brand: null, Category: null }));

    expect(catalog.findProductsByNormalizedName('hoverboard x1', 50)).toEqual([
      { id, brand: null },
    ]);
  });

  it('stores seller-provided text literally', () => {
    const id = catalog.createProduct(
      entry({ Name: 'Security Test Product', Brand: "TestBrand'; SELECT 1; --", Category: null }),
    );

    expect(db.prepare('SELECT Brand FROM Product WHERE Id = ?').pluck().get(id)).toBe(
      "TestBrand'; SELECT 1; --",
    );
  });
});

describe('CatalogDatabase.findOfferProductId', () => {
  it('returns the product the seller SKU points to, or undefined', () => {
    const sellerId = catalog.findOrCreateSeller('MegaStore');
    catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 2));

    expect(catalog.findOfferProductId(sellerId, 'sku-1')).toBe(2);
    expect(catalog.findOfferProductId(sellerId, 'sku-2')).toBeUndefined();
  });
});

describe('CatalogDatabase.addProductReviews', () => {
  const reviews = () =>
    db
      .prepare('SELECT ProductId, SimilarProductId, Reason, Status FROM ProductReview ORDER BY Id')
      .raw()
      .all();

  it('records one pending review per similar product', () => {
    catalog.addProductReviews(3, [1, 2], 'sameNameOtherBrand');

    expect(reviews()).toEqual([
      [3, 1, 'sameNameOtherBrand', 'pending'],
      [3, 2, 'sameNameOtherBrand', 'pending'],
    ]);
  });

  it('ignores a pair that is already recorded', () => {
    catalog.addProductReviews(3, [1], 'sameNameOtherBrand');
    catalog.addProductReviews(3, [1], 'sameNameOtherBrand');

    expect(reviews()).toHaveLength(1);
  });
});

describe('CatalogDatabase merge support', () => {
  it('resolves a merged product to the one it was merged into, still using the index', () => {
    catalog.markMerged(18, 2);

    expect(catalog.findProductsByNormalizedName('camera canon eos r6', 50)).toEqual([
      { id: 2, brand: 'Canon' },
    ]);
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT coalesce(MergedIntoId, Id) AS id, Brand AS brand
         FROM Product WHERE NormalizedName = ? LIMIT ?`,
      )
      .all('x', 2) as { detail: string }[];
    expect(plan.map(({ detail }) => detail).join()).toContain(
      'IX_Product_NormalizedName_Brand_Category',
    );
  });

  it('moves offers and reports how many moved', () => {
    const sellerId = catalog.findOrCreateSeller('MegaStore');
    catalog.addOfferIfAbsent(new Offer(sellerId, 'sku-1', 18));

    // Product 18 also has its marketplace offer from migration 002.
    expect(catalog.moveOffers(18, 2)).toBe(2);
    expect(catalog.findOfferProductId(sellerId, 'sku-1')).toBe(2);
  });

  it('keeps merged products pointing to an active product', () => {
    catalog.markMerged(3, 18);
    catalog.markMerged(18, 2);

    expect(catalog.findProductForMerge(3)).toEqual({ id: 3, mergedIntoId: 2 });
    expect(catalog.findProductForMerge(18)).toEqual({ id: 18, mergedIntoId: 2 });
  });

  it('lists and resolves pending reviews', () => {
    catalog.addProductReviews(18, [2, 3], 'sameNameOtherBrand');
    catalog.addProductReviews(4, [5], 'sameNameOtherBrand');

    expect(
      catalog
        .listPendingReviews()
        .map(({ productId, similarProductId }) => [productId, similarProductId]),
    ).toEqual([
      [18, 2],
      [18, 3],
      [4, 5],
    ]);
    expect(catalog.resolveReviewsOf(18, 'merged')).toBe(2);
    expect(catalog.markReviewDistinct(5, 4)).toBe(1);
    expect(catalog.listPendingReviews()).toEqual([]);
  });
});
