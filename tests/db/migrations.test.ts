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
} from '../../src/infrastructure/sqlite/connection.ts';
import { createMigrator } from '../../src/infrastructure/sqlite/migrations.ts';
import { MARKETPLACE_SELLER_NAME } from '../../migrations/002_marketplace_seller.ts';
import { normalizeAtMigration004 } from '../../migrations/004_product_normalized_name.ts';
import { normalizeProductName } from '../../src/domain/product-name.ts';

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

    expect(await latest()).toEqual([
      '001_seller_and_offer_keys.ts',
      '002_marketplace_seller.ts',
      '003_product_exact_match_index.ts',
      '004_product_normalized_name.ts',
      '005_drop_product_exact_match_index.ts',
      '006_name_synonym.ts',
      '007_product_review.ts',
    ]);
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
        MARKETPLACE_SELLER_NAME,
        'MegaStore',
        'TechWorld',
      ]);
      expect(
        db
          .prepare(
            `SELECT s.Name, sp.SellerProductId, sp.ProductId
             FROM SellerProduct sp JOIN Seller s ON s.Id = sp.SellerId
             WHERE s.Name <> ?
             ORDER BY s.Name, sp.SellerProductId`,
          )
          .raw()
          .all(MARKETPLACE_SELLER_NAME),
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
        productColumns: db.pragma('table_info(Product)'),
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

  it('roll back only the marketplace seller, keeping the 001 schema', async () => {
    await latest();

    await rollBackTo('001');

    withDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) FROM Seller').pluck().get()).toBe(0);
      expect(db.prepare('SELECT COUNT(*) FROM SellerProduct').pluck().get()).toBe(0);
    });
    expect(await latest()).toEqual([
      '002_marketplace_seller.ts',
      '003_product_exact_match_index.ts',
      '004_product_normalized_name.ts',
      '005_drop_product_exact_match_index.ts',
      '006_name_synonym.ts',
      '007_product_review.ts',
    ]);
  });

  it('roll back the Product indexes and column one migration at a time', async () => {
    await latest();
    expect(productIndexes()).toEqual(['IX_Product_NormalizedName_Brand_Category']);

    await rollBackTo('004');
    expect(productIndexes()).toEqual([
      'IX_Product_NormalizedName_Brand_Category',
      'IX_Product_Name_Brand_Category',
    ]);

    await rollBackTo('003');
    expect(productIndexes()).toEqual(['IX_Product_Name_Brand_Category']);
    expect(productColumnNames()).not.toContain('NormalizedName');

    await rollBackTo('002');
    expect(productIndexes()).toEqual([]);
  });

  it('roll back the synonym table', async () => {
    await latest();

    await rollBackTo('005');

    withDatabase((db) => {
      expect(
        db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'NameSynonym'").pluck().get(),
      ).toBe(0);
    });
  });
});

// Rolls back, one migration at a time, until `version` is the last one applied.
const rollBackTo = async (version: string) => {
  while ((await migrator.migrate.currentVersion()) !== version) {
    await migrator.migrate.down();
  }
};

const productIndexes = () =>
  withDatabase((db) =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Product' ORDER BY name DESC",
      )
      .pluck()
      .all(),
  );

const productColumnNames = () =>
  withDatabase((db) =>
    (db.pragma('table_info(Product)') as { name: string }[]).map(({ name }) => name),
  );

describe('normalized product name (migration 004)', () => {
  beforeEach(async () => {
    await latest();
  });

  it('fills NormalizedName for every product', () => {
    withDatabase((db) => {
      expect(
        db.prepare('SELECT COUNT(*) FROM Product WHERE NormalizedName IS NULL').pluck().get(),
      ).toBe(0);
      expect(db.prepare('SELECT NormalizedName FROM Product WHERE Id = 14').pluck().get()).toBe(
        'tablet ipad pro 12.9',
      );
    });
  });

  it('freezes the same normalization the domain uses, for every catalog name', () => {
    const names = withDatabase(
      (db) => db.prepare('SELECT Name FROM Product').pluck().all() as string[],
    );
    const edgeCases = ['Câmera  Canon', "Tablet 12.9''", 'Smart TV 55"', '  Ünïcödé  '];

    for (const name of [...names, ...edgeCases]) {
      expect(normalizeAtMigration004(name)).toBe(normalizeProductName(name));
    }
  });
});

describe('marketplace seller', () => {
  beforeEach(async () => {
    await latest();
  });

  it('offers every existing product, using the product id as its SKU', () => {
    withDatabase((db) => {
      const offers = db
        .prepare(
          `SELECT sp.SellerProductId, sp.ProductId
           FROM SellerProduct sp JOIN Seller s ON s.Id = sp.SellerId
           WHERE s.Name = ?`,
        )
        .all(MARKETPLACE_SELLER_NAME) as { SellerProductId: string; ProductId: number }[];

      expect(offers).toHaveLength(975);
      expect(offers.every((offer) => offer.SellerProductId === String(offer.ProductId))).toBe(true);
    });
  });

  it('leaves no product without a seller', () => {
    withDatabase((db) => {
      expect(
        db
          .prepare(
            'SELECT COUNT(*) FROM Product WHERE Id NOT IN (SELECT ProductId FROM SellerProduct)',
          )
          .pluck()
          .get(),
      ).toBe(0);
    });
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
      db
        .prepare('SELECT COUNT(*) FROM SellerProduct WHERE SellerId = ? AND ProductId = 781')
        .pluck()
        .get(seller),
    ).toBe(2);
  });

  it('rejects the same SKU twice for one seller', () => {
    const seller = insertSeller('GardenStore');
    insertOffer(seller, 'e5e5e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9', 18);

    expect(() => insertOffer(seller, 'e5e5e5e5-f6f6-4a7a-b8b8-c9c9c9c9c9c9', 18)).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('allows the same SKU for different sellers', () => {
    const sku = '00112233-4455-4667-7889-900112233445';
    insertOffer(insertSeller('GardenStore'), sku, 1);
    insertOffer(insertSeller('SportsHub'), sku, 2);

    expect(
      db.prepare('SELECT COUNT(*) FROM SellerProduct WHERE SellerProductId = ?').pluck().get(sku),
    ).toBe(2);
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

describe('name synonyms (migration 006)', () => {
  beforeEach(async () => {
    await latest();
  });

  it('starts with the translations found in the challenge data', () => {
    expect(
      withDatabase((db) =>
        db.prepare('SELECT Term, Replacement FROM NameSynonym ORDER BY Term').raw().all(),
      ),
    ).toEqual([
      ['processador', 'processor'],
      ['roteador', 'router'],
    ]);
  });

  it.each([
    ['an empty term', ''],
    ['a term with several words', 'placa mae'],
  ])('refuses %s', (_, term) => {
    withDatabase((db) => {
      expect(() =>
        db.prepare('INSERT INTO NameSynonym (Term, Replacement) VALUES (?, ?)').run(term, 'x'),
      ).toThrow(/CHECK constraint failed/);
    });
  });

  it('refuses the same term twice, regardless of case', () => {
    withDatabase((db) => {
      expect(() =>
        db
          .prepare('INSERT INTO NameSynonym (Term, Replacement) VALUES (?, ?)')
          .run('ROTEADOR', 'router'),
      ).toThrow(/UNIQUE constraint failed/);
    });
  });
});

describe('product review (migration 007)', () => {
  beforeEach(async () => {
    await latest();
  });

  const insertReview = (db: Database.Database, productId: number, similarProductId: number) =>
    db
      .prepare('INSERT INTO ProductReview (ProductId, SimilarProductId, Reason) VALUES (?, ?, ?)')
      .run(productId, similarProductId, 'sameNameOtherBrand');

  it('starts empty, with pending status and creation time by default', () => {
    withDatabase((db) => {
      expect(db.prepare('SELECT COUNT(*) FROM ProductReview').pluck().get()).toBe(0);
      insertReview(db, 1, 2);
      expect(db.prepare('SELECT Status, CreatedAt FROM ProductReview').get()).toMatchObject({
        Status: 'pending',
        CreatedAt: expect.any(String),
      });
    });
  });

  it.each([
    [
      'an unknown reason',
      "INSERT INTO ProductReview (ProductId, SimilarProductId, Reason) VALUES (1, 2, 'guess')",
    ],
    [
      'an unknown status',
      "INSERT INTO ProductReview (ProductId, SimilarProductId, Reason, Status) VALUES (1, 2, 'sameNameOtherBrand', 'done')",
    ],
    [
      'a product reviewed against itself',
      "INSERT INTO ProductReview (ProductId, SimilarProductId, Reason) VALUES (1, 1, 'sameNameOtherBrand')",
    ],
  ])('refuses %s', (_, sql) => {
    withDatabase((db) => {
      expect(() => db.exec(sql)).toThrow(/CHECK constraint failed/);
    });
  });

  it('refuses the same pair twice and unknown products', () => {
    withDatabase((db) => {
      insertReview(db, 1, 2);
      expect(() => insertReview(db, 1, 2)).toThrow(/UNIQUE constraint failed/);
      expect(() => insertReview(db, 1, 999_999)).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  it('rolls back', async () => {
    await rollBackTo('006');

    withDatabase((db) => {
      expect(
        db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'ProductReview'").pluck().get(),
      ).toBe(0);
    });
  });
});
