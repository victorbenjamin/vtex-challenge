import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANDIDATE_LIMIT, ProductMatcher } from '../../src/application/product-matcher.ts';
import { SellerProductEntry } from '../../src/domain/seller-product-entry.ts';
import { CatalogDatabase } from '../../src/infrastructure/sqlite/catalog-database.ts';
import { createMigratedDatabase, type MigratedDatabase } from '../helpers/working-database.ts';

let migrated: MigratedDatabase;
let db: Database.Database;
let matcher: ProductMatcher;

beforeEach(async () => {
  migrated = await createMigratedDatabase();
  db = migrated.db;
  const catalog = new CatalogDatabase(db);
  matcher = new ProductMatcher(catalog, catalog.loadNameSynonyms());
});

afterEach(() => {
  migrated.cleanup();
});

const entry = (Name: string, Brand: string | null) => {
  const parsed = SellerProductEntry.parse({ Id: 'sku', SellerName: 'MegaStore', Name, Brand });
  if (!parsed) {
    throw new Error('invalid test entry');
  }
  return parsed;
};

const insertProduct = (name: string, brand: string | null, normalizedName: string) =>
  Number(
    db
      .prepare('INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)')
      .run(name, brand, 'Fitness', normalizedName).lastInsertRowid,
  );

describe('ProductMatcher.match', () => {
  it('finds the product by the entry own name', () => {
    expect(matcher.match(entry('Smartphone  Galaxy S23', 'Samsung'))).toEqual({
      kind: 'found',
      productId: 2,
      matchedBy: 'name',
    });
  });

  it('finds the product by the translated name when the own name finds none', () => {
    expect(matcher.match(entry('Roteador WiFi 6 TP-Link', 'TP-Link'))).toEqual({
      kind: 'found',
      productId: 21,
      matchedBy: 'translatedName',
    });
  });

  it('lists the candidates of an ambiguous name and brand', () => {
    const ids = [
      insertProduct('Yoga Mat', 'Gaiam', 'yoga mat'),
      insertProduct('YOGA MAT', 'Gaiam', 'yoga mat'),
    ];

    expect(matcher.match(entry('Yoga Mat', 'Gaiam'))).toEqual({
      kind: 'ambiguous',
      candidateProductIds: ids,
    });
  });

  it('gives up on a name too generic to check every product of it', () => {
    for (let i = 0; i < CANDIDATE_LIMIT; i++) {
      insertProduct('Yoga Mat', `Brand ${i}`, 'yoga mat');
    }

    expect(matcher.match(entry('Yoga Mat', 'Gaiam'))).toEqual({ kind: 'tooManyCandidates' });
  });

  it('reports the products of the name under another brand when none is of the entry brand', () => {
    expect(matcher.match(entry('Smartphone Galaxy S23', 'Samsung Electronics'))).toEqual({
      kind: 'notFound',
      similarProductIds: [2],
    });
    expect(matcher.match(entry('Hoverboard X1', 'Segway'))).toEqual({
      kind: 'notFound',
      similarProductIds: [],
    });
  });
});
