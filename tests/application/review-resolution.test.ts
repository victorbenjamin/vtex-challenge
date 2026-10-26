import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARKETPLACE_SELLER_NAME } from '../../migrations/002_marketplace_seller.ts';
import { MarkDistinct } from '../../src/application/mark-distinct.ts';
import { MergeProducts } from '../../src/application/merge-products.ts';
import { CatalogDatabase } from '../../src/infrastructure/sqlite/catalog-database.ts';
import {
  createMigratedDatabase,
  sqliteImportCatalog,
  type MigratedDatabase,
} from '../helpers/working-database.ts';

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

// Catalog #2: Smartphone Galaxy S23, brand Samsung.
const galaxy = (Id: string, SellerName: string, Brand: string) => ({
  Id,
  SellerName,
  Name: 'Smartphone Galaxy S23',
  Brand,
  Category: 'Electronics',
});

const run = (items: object[]) => sqliteImportCatalog(db).execute(items).counts();
const merge = (duplicateId: number, targetId: number) =>
  new MergeProducts(catalog).execute(duplicateId, targetId);
const markDistinct = (productId: number, similarProductId: number) =>
  new MarkDistinct(catalog).execute(productId, similarProductId);

const offerProduct = (sellerName: string, sku: string) =>
  db
    .prepare(
      `SELECT sp.ProductId FROM SellerProduct sp JOIN Seller s ON s.Id = sp.SellerId
       WHERE s.Name = ? AND sp.SellerProductId = ?`,
    )
    .pluck()
    .get(sellerName, sku) as number | undefined;

const reviewStatuses = () =>
  db
    .prepare('SELECT ProductId, SimilarProductId, Status FROM ProductReview ORDER BY Id')
    .raw()
    .all();

const productCount = () => db.prepare('SELECT COUNT(*) FROM Product').pluck().get();

// Imports "Galaxy S23 / Samsung Electronics", which creates the duplicate D of #2 under
// review, and returns D's id.
const createDuplicate = () => {
  run([galaxy('sku-1', 'MegaStore', 'Samsung Electronics')]);
  return offerProduct('MegaStore', 'sku-1') as number;
};

describe('MergeProducts', () => {
  it('moves the duplicate offers, marks it as merged and resolves its review', () => {
    const duplicate = createDuplicate();

    expect(merge(duplicate, 2)).toEqual({ movedOffers: 1, resolvedReviews: 1 });
    expect(offerProduct('MegaStore', 'sku-1')).toBe(2);
    expect(catalog.findProductForMerge(duplicate)).toEqual({ id: duplicate, mergedIntoId: 2 });
    expect(reviewStatuses()).toEqual([[duplicate, 2, 'merged']]);
  });

  it('moves the offers of every seller, the marketplace included', () => {
    // Any pair can be merged: here two catalog products, both offered by the marketplace.
    run([galaxy('sku-1', 'TechWorld', 'Samsung')]);
    const iphoneOffers = db
      .prepare('SELECT COUNT(*) FROM SellerProduct WHERE ProductId = 3')
      .pluck()
      .get();

    expect(merge(3, 2).movedOffers).toBe(iphoneOffers);
    expect(offerProduct(MARKETPLACE_SELLER_NAME, '3')).toBe(2);
    expect(offerProduct(MARKETPLACE_SELLER_NAME, '2')).toBe(2);
    expect(offerProduct('TechWorld', 'sku-1')).toBe(2);
  });

  it('resolves every pending review about the duplicate', () => {
    const duplicate = createDuplicate();
    catalog.addProductReviews(duplicate, [3], 'sameNameOtherBrand');

    expect(merge(duplicate, 2).resolvedReviews).toBe(2);
    expect(catalog.listPendingReviews()).toEqual([]);
  });

  it('repoints products previously merged into the duplicate', () => {
    merge(3, 18);
    merge(18, 2);

    expect(catalog.findProductForMerge(3)).toEqual({ id: 3, mergedIntoId: 2 });
  });

  it.each([
    ['the same product', 2, 2, /into itself/],
    ['an unknown duplicate', 999_999, 2, /Duplicate product 999999 does not exist/],
    ['an unknown target', 2, 999_999, /Target product 999999 does not exist/],
  ])('refuses %s', (_, duplicate, target, message) => {
    expect(() => merge(duplicate, target)).toThrow(message);
  });

  it('refuses a duplicate or a target that was already merged', () => {
    merge(3, 2);

    expect(() => merge(3, 4)).toThrow(/Duplicate product 3 was already merged into 2/);
    expect(() => merge(4, 3)).toThrow(/Target product 3 was already merged into 2/);
  });

  it('rolls back everything when a step fails', () => {
    const duplicate = createDuplicate();
    db.exec(`
      CREATE TRIGGER fail_on_merge BEFORE UPDATE OF MergedIntoId ON Product
      BEGIN SELECT RAISE(ABORT, 'merge failed'); END`);

    expect(() => merge(duplicate, 2)).toThrow(/merge failed/);
    expect(offerProduct('MegaStore', 'sku-1')).toBe(duplicate);
    expect(reviewStatuses()).toEqual([[duplicate, 2, 'pending']]);
  });
});

describe('merging an ambiguous catalog duplicate', () => {
  it('resolves the ambiguity: both candidates now resolve to the same product', () => {
    // A catalog duplicate of #2 with the same name and brand makes #2 ambiguous...
    const copy = Number(
      db
        .prepare('INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)')
        .run('SMARTPHONE GALAXY S23', 'SAMSUNG', 'Electronics', 'smartphone galaxy s23')
        .lastInsertRowid,
    );
    expect(run([galaxy('sku-1', 'MegaStore', 'Samsung')])).toMatchObject({ unmatched: 1 });

    // ...until the copy is merged into #2.
    merge(copy, 2);

    expect(run([galaxy('sku-1', 'MegaStore', 'Samsung')])).toMatchObject({ linked: 1 });
    expect(offerProduct('MegaStore', 'sku-1')).toBe(2);
  });
});

describe('MarkDistinct', () => {
  it('ends the pending review of the pair, in either direction, without touching offers', () => {
    const duplicate = createDuplicate();

    markDistinct(2, duplicate);

    expect(reviewStatuses()).toEqual([[duplicate, 2, 'distinct']]);
    expect(offerProduct('MegaStore', 'sku-1')).toBe(duplicate);
  });

  it('refuses a pair without a pending review', () => {
    expect(() => markDistinct(1, 2)).toThrow(/no pending review of products 1 and 2/);
  });
});

describe('the same brand variation coming back', () => {
  it('while the review is pending: links to the duplicate, and the merge moves every offer', () => {
    const duplicate = createDuplicate();

    expect(run([galaxy('sku-9', 'TechWorld', 'Samsung Electronics')])).toMatchObject({
      linked: 1,
      created: 0,
      createdForReview: 0,
    });
    expect(offerProduct('TechWorld', 'sku-9')).toBe(duplicate);
    expect(catalog.listPendingReviews()).toHaveLength(1);

    expect(merge(duplicate, 2).movedOffers).toBe(2);
    expect(offerProduct('MegaStore', 'sku-1')).toBe(2);
    expect(offerProduct('TechWorld', 'sku-9')).toBe(2);
  });

  describe('after merging the duplicate into #2', () => {
    let duplicate: number;
    beforeEach(() => {
      duplicate = createDuplicate();
      merge(duplicate, 2);
    });

    it('a re-sent item of the duplicate is already linked', () => {
      expect(run([galaxy('sku-1', 'MegaStore', 'Samsung Electronics')])).toMatchObject({
        alreadyLinked: 1,
        conflict: 0,
      });
    });

    it.each([
      ['Samsung', 'the target brand'],
      ['Samsung Electronics', 'the duplicate brand, as an alias'],
    ])('a new seller with brand %s (%s) links to #2, with no new product or review', (brand) => {
      const products = productCount();

      expect(run([galaxy('sku-9', 'TechWorld', brand)])).toMatchObject({ linked: 1 });
      expect(offerProduct('TechWorld', 'sku-9')).toBe(2);
      expect(productCount()).toBe(products);
      expect(catalog.listPendingReviews()).toEqual([]);
    });

    it('a new brand variation creates a product reviewed against #2 only', () => {
      expect(run([galaxy('sku-9', 'TechWorld', 'Samsung Elec.')])).toMatchObject({
        createdForReview: 1,
      });
      expect(catalog.listPendingReviews().map(({ similarProductId }) => similarProductId)).toEqual([
        2,
      ]);
    });
  });

  describe('after marking the duplicate and #2 as distinct', () => {
    let duplicate: number;
    beforeEach(() => {
      duplicate = createDuplicate();
      markDistinct(duplicate, 2);
    });

    it.each([
      ['Samsung', 2],
      ['Samsung Electronics', 'duplicate'],
    ] as const)(
      'a new seller with brand %s links to its own product, with no new review',
      (brand, expected) => {
        const products = productCount();

        expect(run([galaxy('sku-9', 'TechWorld', brand)])).toMatchObject({ linked: 1 });
        expect(offerProduct('TechWorld', 'sku-9')).toBe(expected === 'duplicate' ? duplicate : 2);
        expect(productCount()).toBe(products);
        expect(catalog.listPendingReviews()).toEqual([]);
      },
    );

    it('a new brand variation creates a product reviewed against both', () => {
      expect(run([galaxy('sku-9', 'TechWorld', 'Samsung Elec.')])).toMatchObject({
        createdForReview: 1,
      });
      expect(
        catalog
          .listPendingReviews()
          .map(({ similarProductId }) => similarProductId)
          .sort((a, b) => a - b),
      ).toEqual([2, duplicate]);
    });
  });
});
