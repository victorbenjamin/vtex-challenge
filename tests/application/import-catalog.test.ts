import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANDIDATE_LIMIT } from '../../src/application/import-catalog.ts';
import { MergeProducts } from '../../src/application/merge-products.ts';
import { CatalogDatabase } from '../../src/infrastructure/sqlite/catalog-database.ts';
import type { ImportRecord } from '../../src/domain/import-record.ts';
import { MARKETPLACE_SELLER_NAME } from '../../migrations/002_marketplace_seller.ts';
import {
  createMigratedDatabase,
  sqliteImportCatalog,
  type MigratedDatabase,
} from '../helpers/working-database.ts';

let migrated: MigratedDatabase;
let db: Database.Database;

beforeEach(async () => {
  migrated = await createMigratedDatabase();
  db = migrated.db;
});

afterEach(() => {
  migrated.cleanup();
});

// Catalog products used below: #2 Smartphone Galaxy S23, #3 iPhone 15 Pro.
const galaxy = { Name: 'Smartphone Galaxy S23', Brand: 'Samsung', Category: 'Electronics' };
const iphone = { Name: 'iPhone 15 Pro', Brand: 'Apple', Category: 'Electronics' };

const run = (items: object[]) => sqliteImportCatalog(db).execute(items);
const countsOf = (items: object[]) => run(items).counts();

const offersOf = (sellerName: string) =>
  db
    .prepare(
      `SELECT sp.SellerProductId, sp.ProductId
       FROM SellerProduct sp JOIN Seller s ON s.Id = sp.SellerId
       WHERE s.Name = ? ORDER BY sp.SellerProductId`,
    )
    .raw()
    .all(sellerName) as [string, number][];

const productCount = () => db.prepare('SELECT COUNT(*) FROM Product').pluck().get();

// Pending reviews as [created product name and brand, similar product id].
const pendingReviews = () =>
  db
    .prepare(
      `SELECT p.Name || ' / ' || coalesce(p.Brand, '-'), r.SimilarProductId
       FROM ProductReview r JOIN Product p ON p.Id = r.ProductId
       WHERE r.Status = 'pending' ORDER BY r.Id`,
    )
    .raw()
    .all();

const hoverboard = { Name: 'Hoverboard X1', Brand: 'Segway', Category: 'Toys' };

const externalSellers = () =>
  db
    .prepare('SELECT Name FROM Seller WHERE Name <> ? ORDER BY Name')
    .pluck()
    .all(MARKETPLACE_SELLER_NAME);

describe('ImportCatalog', () => {
  it('links exact matches to the catalog product', () => {
    expect(countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy }])).toMatchObject({
      linked: 1,
    });
    expect(offersOf('MegaStore')).toEqual([['sku-1', 2]]);
  });

  describe('creating products', () => {
    it('creates a product when no catalog product has the name', () => {
      expect(countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...hoverboard }])).toMatchObject({
        created: 1,
        createdForReview: 0,
      });
      const product = db
        .prepare('SELECT * FROM Product WHERE Id = (SELECT MAX(Id) FROM Product)')
        .get() as Record<string, unknown>;
      expect(product).toMatchObject({ ...hoverboard, NormalizedName: 'hoverboard x1' });
      expect(offersOf('MegaStore')).toEqual([['sku-1', product['Id']]]);
      expect(pendingReviews()).toEqual([]);
    });

    it('does not offer a created product as the marketplace', () => {
      run([{ Id: 'sku-1', SellerName: 'MegaStore', ...hoverboard }]);

      expect(offersOf(MARKETPLACE_SELLER_NAME)).toHaveLength(975);
    });

    it('creates the product once when several sellers send it in the same file', () => {
      expect(
        countsOf([
          { Id: 'sku-1', SellerName: 'MegaStore', ...hoverboard },
          { Id: 'sku-9', SellerName: 'TechWorld', ...hoverboard, Name: 'HOVERBOARD  X1' },
        ]),
      ).toMatchObject({ created: 1, linked: 1 });
      expect(offersOf('TechWorld')[0]?.[1]).toBe(offersOf('MegaStore')[0]?.[1]);
      expect(productCount()).toBe(976);
    });

    it('is idempotent', () => {
      const items = [{ Id: 'sku-1', SellerName: 'MegaStore', ...hoverboard }];
      run(items);

      expect(countsOf(items)).toMatchObject({ created: 0, alreadyLinked: 1 });
      expect(productCount()).toBe(976);
    });

    it('creates nothing when the seller SKU already points to a product', () => {
      run([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy }]);

      expect(countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...hoverboard }])).toMatchObject({
        conflict: 1,
        created: 0,
      });
      expect(productCount()).toBe(975);
      expect(offersOf('MegaStore')).toEqual([['sku-1', 2]]);
    });

    it('creates a product for review when the name exists only with another brand', () => {
      // "Samsung Electronics" may be "Samsung" spelled another way: the seller gets its own
      // product, never a possibly wrong one, and the possible duplicate of #2 is recorded.
      expect(
        countsOf([
          { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Brand: 'Samsung Electronics' },
        ]),
      ).toMatchObject({ linked: 0, created: 0, createdForReview: 1 });
      expect(offersOf('MegaStore')[0]?.[1]).not.toBe(2);
      expect(pendingReviews()).toEqual([['Smartphone Galaxy S23 / Samsung Electronics', 2]]);
    });

    it('records every existing product of the name for review', () => {
      const insert = db.prepare(
        'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
      );
      const gaiam = Number(
        insert.run('Yoga Mat Pro', 'Gaiam', 'Fitness', 'yoga mat pro').lastInsertRowid,
      );
      const manduka = Number(
        insert.run('Yoga Mat Pro', 'Manduka', 'Fitness', 'yoga mat pro').lastInsertRowid,
      );

      run([
        {
          Id: 'sku-1',
          SellerName: 'MegaStore',
          Name: 'Yoga Mat Pro',
          Brand: 'Liforme',
          Category: 'Fitness',
        },
      ]);

      expect(pendingReviews()).toEqual(
        expect.arrayContaining([
          ['Yoga Mat Pro / Liforme', gaiam],
          ['Yoga Mat Pro / Liforme', manduka],
        ]),
      );
      expect(pendingReviews()).toHaveLength(2);
    });
  });

  it('creates each seller once, ignoring case and surrounding spaces', () => {
    run([
      { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
      { Id: 'sku-2', SellerName: ' megastore ', ...iphone },
    ]);

    expect(externalSellers()).toEqual(['MegaStore']);
    expect(offersOf('MegaStore')).toEqual([
      ['sku-1', 2],
      ['sku-2', 3],
    ]);
  });

  it('keeps the same seller id from different sellers as distinct offers', () => {
    const sku = '00112233-4455-4667-7889-900112233445';
    run([
      { Id: sku, SellerName: 'GardenStore', ...galaxy },
      { Id: sku, SellerName: 'SportsHub', ...iphone },
    ]);

    expect(offersOf('GardenStore')).toEqual([[sku, 2]]);
    expect(offersOf('SportsHub')).toEqual([[sku, 3]]);
  });

  it('is idempotent', () => {
    const items = [
      { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
      { Id: 'sku-2', SellerName: 'TechWorld', ...iphone },
    ];
    run(items);

    expect(countsOf(items)).toMatchObject({ linked: 0, alreadyLinked: 2 });
    expect(externalSellers()).toEqual(['MegaStore', 'TechWorld']);
  });

  it('counts a conflict and keeps the existing offer when a seller SKU changes product', () => {
    run([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy }]);

    expect(countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...iphone }])).toMatchObject({
      linked: 0,
      conflict: 1,
    });
    expect(offersOf('MegaStore')).toEqual([['sku-1', 2]]);
  });

  it('accepts items from the marketplace as offers of its own seller', () => {
    expect(
      countsOf([
        { Id: 'mkt-1', SellerName: MARKETPLACE_SELLER_NAME, ...galaxy },
        { Id: 'mkt-2', SellerName: ` ${MARKETPLACE_SELLER_NAME.toUpperCase()} `, ...iphone },
      ]),
    ).toMatchObject({ linked: 2, rejected: 0 });
    expect(offersOf(MARKETPLACE_SELLER_NAME)).toHaveLength(977);
    expect(externalSellers()).toEqual([]);
  });

  it('recognizes the marketplace offers created by migration 002', () => {
    // Migration 002 offers each product with its id as the SKU.
    expect(countsOf([{ Id: '2', SellerName: MARKETPLACE_SELLER_NAME, ...galaxy }])).toMatchObject({
      alreadyLinked: 1,
    });
  });

  it('links names that differ from the catalog only in spelling', () => {
    expect(
      countsOf([
        { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Name: 'Smartphone  Galaxy S23' },
        { Id: 'sku-2', SellerName: 'MegaStore', ...iphone, Name: 'IPHONE 15 PRO' },
      ]),
    ).toMatchObject({ linked: 2, unmatched: 0 });
    expect(offersOf('MegaStore')).toEqual([
      ['sku-1', 2],
      ['sku-2', 3],
    ]);
  });

  it('treats catalog products that differ only in spelling as ambiguous, even for an exact name', () => {
    // Trade-off of matching by normalized name only: recall is lost here, precision is kept.
    db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    ).run('SMARTPHONE GALAXY S23', 'Samsung', 'Electronics', 'smartphone galaxy s23');

    expect(countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy }])).toMatchObject({
      linked: 0,
      unmatched: 1,
    });
  });

  it('never links a name that is ambiguous after normalization', () => {
    const insert = db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    );
    insert.run('Yoga Mat Pro', 'Gaiam', 'Fitness', 'yoga mat pro');
    insert.run('YOGA MAT PRO', 'Gaiam', 'Fitness', 'yoga mat pro');

    expect(
      countsOf([
        {
          Id: 'sku-1',
          SellerName: 'MegaStore',
          Name: 'Yoga  Mat Pro',
          Brand: 'Gaiam',
          Category: 'Fitness',
        },
      ]),
    ).toMatchObject({ linked: 0, unmatched: 1 });
  });

  it('never links, nor creates, attributes shared by more than one catalog product', () => {
    const insert = db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    );
    insert.run('Yoga Mat Duplicate', 'Gaiam', 'Fitness', 'yoga mat duplicate');
    insert.run('Yoga Mat Duplicate', 'Gaiam', 'Fitness', 'yoga mat duplicate');

    expect(
      countsOf([
        {
          Id: 'sku-1',
          SellerName: 'MegaStore',
          Name: 'Yoga Mat Duplicate',
          Brand: 'Gaiam',
          Category: 'Fitness',
        },
      ]),
    ).toMatchObject({ linked: 0, created: 0, createdForReview: 0, unmatched: 1 });
  });

  it('links a brand spelled differently', () => {
    // Catalog #322: Belt Leather Reversible, brand "Levis".
    expect(
      countsOf([
        {
          Id: 'sku-1',
          SellerName: 'SportsHub',
          Name: 'Belt Leather Reversible',
          Brand: "Levi's",
          Category: 'Accessories',
        },
      ]),
    ).toMatchObject({ linked: 1 });
    expect(offersOf('SportsHub')).toEqual([['sku-1', 322]]);
  });

  it('links regardless of the category', () => {
    expect(
      countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Category: 'Phones' }]),
    ).toMatchObject({ linked: 1 });
    expect(offersOf('MegaStore')).toEqual([['sku-1', 2]]);
  });

  it('does not link a missing brand to a product that has one: creates one for review', () => {
    expect(
      countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Brand: null }]),
    ).toMatchObject({ linked: 0, createdForReview: 1 });
    expect(pendingReviews()).toEqual([['Smartphone Galaxy S23 / -', 2]]);
  });

  describe('with several catalog products of the same name', () => {
    const insertProduct = (brand: string | null, category: string) =>
      Number(
        db
          .prepare(
            'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
          )
          .run('Yoga Mat Pro', brand, category, 'yoga mat pro').lastInsertRowid,
      );
    const yogaMat = (Brand: string | null) => ({
      Id: 'sku-1',
      SellerName: 'MegaStore',
      Name: 'Yoga  Mat Pro',
      Brand,
      Category: 'Fitness',
    });

    it('links the one with the entry brand', () => {
      insertProduct('Gaiam', 'Fitness');
      const manduka = insertProduct('Manduka', 'Fitness');

      expect(countsOf([yogaMat('MANDUKA')])).toMatchObject({ linked: 1 });
      expect(offersOf('MegaStore')).toEqual([['sku-1', manduka]]);
    });

    it('never links when they share the brand, even with different categories', () => {
      insertProduct('Gaiam', 'Fitness');
      insertProduct('Gaiam', 'Outdoor');

      expect(countsOf([yogaMat('Gaiam')])).toMatchObject({ linked: 0, unmatched: 1 });
    });

    it(`never links when there are ${CANDIDATE_LIMIT} or more to compare`, () => {
      for (let i = 0; i < CANDIDATE_LIMIT - 1; i++) {
        insertProduct(`Brand ${i}`, 'Fitness');
      }
      insertProduct('Gaiam', 'Fitness');

      expect(countsOf([yogaMat('Gaiam')])).toMatchObject({ linked: 0, unmatched: 1 });
    });
  });

  describe('with name synonyms', () => {
    // Catalog #21: Router WiFi 6 TP-Link. Migration 006 maps "roteador" to "router".
    const roteador = {
      Id: 'sku-1',
      SellerName: 'FootwearHub',
      Name: 'Roteador WiFi 6 TP-Link',
      Brand: 'TP-Link',
      Category: 'Networking',
    };

    it('links a name translated to the catalog vocabulary', () => {
      expect(countsOf([roteador])).toMatchObject({ linked: 1 });
      expect(offersOf('FootwearHub')).toEqual([['sku-1', 21]]);
    });

    it('prefers a product with the entry own name over the translated one', () => {
      const ownName = Number(
        db
          .prepare(
            'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
          )
          .run('Roteador WiFi 6 TP-Link', 'TP-Link', 'Networking', 'roteador wifi 6 tp-link')
          .lastInsertRowid,
      );

      run([roteador]);

      expect(offersOf('FootwearHub')).toEqual([['sku-1', ownName]]);
    });

    it('does not fall back to the translation when the own name is ambiguous', () => {
      const insert = db.prepare(
        'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
      );
      insert.run('Roteador WiFi 6 TP-Link', 'TP-Link', 'Networking', 'roteador wifi 6 tp-link');
      insert.run('ROTEADOR WIFI 6 TP-LINK', 'TP-Link', 'Networking', 'roteador wifi 6 tp-link');

      expect(countsOf([roteador])).toMatchObject({ linked: 0, unmatched: 1 });
    });

    it('still requires the brand after translating, and reviews against the translated name', () => {
      expect(countsOf([{ ...roteador, Brand: 'Netgear' }])).toMatchObject({
        linked: 0,
        createdForReview: 1,
      });
      expect(pendingReviews()).toEqual([['Roteador WiFi 6 TP-Link / Netgear', 21]]);
    });

    it('uses a synonym added to the table, with no migration', () => {
      const teclado = {
        Id: 'sku-2',
        SellerName: 'MegaStore',
        Name: 'Teclado Mechanical RGB',
        Brand: 'Corsair',
        Category: 'Accessories',
      };
      db.prepare('INSERT INTO NameSynonym (Term, Replacement) VALUES (?, ?)').run(
        'teclado',
        'keyboard',
      );

      // Catalog #7: Keyboard Mechanical RGB.
      expect(countsOf([teclado])).toMatchObject({ linked: 1 });
      expect(offersOf('MegaStore')).toEqual([['sku-2', 7]]);
    });
  });

  it('treats a numeric seller id and the same id as text as the same SKU', () => {
    expect(countsOf([{ Id: 123, SellerName: 'MegaStore', ...galaxy }])).toMatchObject({
      linked: 1,
    });
    expect(offersOf('MegaStore')).toEqual([['123', 2]]);

    expect(countsOf([{ Id: '123', SellerName: 'MegaStore', ...galaxy }])).toMatchObject({
      alreadyLinked: 1,
    });
  });

  it('rejects invalid items without stopping the import', () => {
    expect(
      countsOf([
        { Id: '', SellerName: 'MegaStore', ...galaxy },
        null,
        { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
      ] as object[]),
    ).toMatchObject({ rejected: 2, linked: 1 });
  });
});

describe('ImportCatalog transactions', () => {
  // Fails the write of one offer, rolling back that item's transaction.
  const failOn = (sellerProductId: string) =>
    db.exec(`
      CREATE TRIGGER fail_on_sku BEFORE INSERT ON SellerProduct
      WHEN NEW.SellerProductId = '${sellerProductId}'
      BEGIN SELECT RAISE(ABORT, 'write failed'); END`);

  const items = [
    { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
    { Id: 'sku-2', SellerName: 'MegaStore', ...iphone },
    { Id: 'boom', SellerName: 'TechWorld', ...galaxy },
    { Id: 'sku-4', SellerName: 'TechWorld', ...iphone },
  ];

  it('rolls back only the failing item, keeps the earlier ones and stops', () => {
    failOn('boom');

    const summary = run(items);

    expect(summary.failure).toEqual({ index: 2, message: 'write failed' });
    expect(summary.counts()).toMatchObject({ linked: 2 });
    expect(offersOf('MegaStore')).toEqual([
      ['sku-1', 2],
      ['sku-2', 3],
    ]);
    // The failing item's seller was created inside its transaction and rolled back with it.
    expect(externalSellers()).toEqual(['MegaStore']);
  });

  it('completes the import when re-run after the failure is fixed', () => {
    failOn('boom');
    run(items);
    db.exec('DROP TRIGGER fail_on_sku');

    const summary = run(items);

    expect(summary.counts()).toMatchObject({ linked: 2, alreadyLinked: 2 });
    expect(summary.failure).toBeUndefined();
  });
});

describe('ImportCatalog report records', () => {
  const recordsOf = (items: unknown[]) => {
    const records: ImportRecord[] = [];
    sqliteImportCatalog(db).execute(items, (record) => records.push(record));
    return records;
  };

  it('records each item, in file order, with what happened and why', () => {
    db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    ).run('Smartphone Galaxy S23', 'Other Brand', 'Electronics', 'smartphone galaxy s23');
    const yogaMats = [1, 2].map((n) =>
      Number(
        db
          .prepare(
            'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
          )
          .run(`Yoga Mat ${n}`, 'Gaiam', 'Fitness', 'yoga mat').lastInsertRowid,
      ),
    );

    const records = recordsOf([
      { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
      { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
      { Id: 'sku-1', SellerName: 'MegaStore', ...iphone },
      {
        Id: 'sku-2',
        SellerName: 'MegaStore',
        Name: 'Roteador WiFi 6 TP-Link',
        Brand: 'TP-Link',
        Category: 'Networking',
      },
      { Id: 'sku-3', SellerName: 'MegaStore', ...hoverboard },
      { Id: 'sku-4', SellerName: 'MegaStore', ...galaxy, Brand: 'Samsung Electronics' },
      {
        Id: 'sku-5',
        SellerName: 'MegaStore',
        Name: 'Yoga Mat',
        Brand: 'Gaiam',
        Category: 'Fitness',
      },
      { Id: '', SellerName: 'MegaStore', ...galaxy },
    ]);

    expect(records.map(({ index, outcome, reason }) => [index, outcome, reason])).toEqual([
      [0, 'linked', 'matchedByName'],
      [1, 'alreadyLinked', 'matchedByName'],
      [2, 'conflict', 'skuPointsToAnotherProduct'],
      [3, 'linked', 'matchedByTranslatedName'],
      [4, 'created', 'nameNotInCatalog'],
      [5, 'createdForReview', 'nameExistsWithOtherBrand'],
      [6, 'unmatched', 'ambiguous'],
      [7, 'rejected', 'Id must be non-empty text or a whole number'],
    ]);
    expect(records[0]).toEqual({
      index: 0,
      outcome: 'linked',
      reason: 'matchedByName',
      sellerName: 'MegaStore',
      sellerProductId: 'sku-1',
      name: 'Smartphone Galaxy S23',
      brand: 'Samsung',
      productId: 2,
    });
    expect(records[2]).toMatchObject({ productId: 3, existingProductId: 2 });
    expect(records[3]).toMatchObject({ productId: 21 });
    expect(records[4]?.productId).toEqual(expect.any(Number));
    expect(records[5]?.similarProductIds).toHaveLength(2);
    expect(records[6]?.candidateProductIds).toEqual(yogaMats);
    expect(records[7]).toEqual({
      index: 7,
      outcome: 'rejected',
      reason: 'Id must be non-empty text or a whole number',
    });
  });

  it('records a conflict on a new product with the product the SKU points to', () => {
    run([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy }]);

    expect(recordsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...hoverboard }])).toEqual([
      expect.objectContaining({
        outcome: 'conflict',
        reason: 'skuPointsToAnotherProduct',
        existingProductId: 2,
      }),
    ]);
  });

  it('records the failure that stopped the import, and nothing for the rolled back item', () => {
    db.exec(`
      CREATE TRIGGER fail_on_sku BEFORE INSERT ON SellerProduct
      WHEN NEW.SellerProductId = 'boom'
      BEGIN SELECT RAISE(ABORT, 'write failed'); END`);

    const records = recordsOf([
      { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy },
      { Id: 'boom', SellerName: 'MegaStore', ...iphone },
      { Id: 'sku-3', SellerName: 'MegaStore', ...iphone },
    ]);

    expect(records.map(({ index, outcome, reason }) => [index, outcome, reason])).toEqual([
      [0, 'linked', 'matchedByName'],
      [1, 'failed', 'write failed'],
    ]);
  });
});

describe('ImportCatalog similar names', () => {
  const similarReviews = () =>
    db
      .prepare(
        `SELECT SimilarProductId, Reason FROM ProductReview WHERE Status = 'pending' ORDER BY Id`,
      )
      .raw()
      .all();

  it.each([
    ['a typo', 'Smarthpone Galaxy S23'],
    ['another word order', 'Galaxy S23 Smartphone'],
  ])('creates a product for review when the name has %s', (_, Name) => {
    const records: ImportRecord[] = [];
    sqliteImportCatalog(db).execute(
      [{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Name }],
      (record) => records.push(record),
    );

    expect(records[0]).toMatchObject({
      outcome: 'createdForReview',
      reason: 'similarNameExists',
      similarProductIds: [2],
    });
    expect(similarReviews()).toEqual([[2, 'similarName']]);
  });

  it('creates another model without review', () => {
    expect(
      countsOf([
        { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Name: 'Smartphone Galaxy S24' },
      ]),
    ).toMatchObject({ created: 1, createdForReview: 0 });
    expect(similarReviews()).toEqual([]);
  });

  it('only compares names within the brand', () => {
    expect(
      countsOf([
        {
          Id: 'sku-1',
          SellerName: 'MegaStore',
          ...galaxy,
          Name: 'Smarthpone Galaxy S23',
          Brand: 'Xiaomi',
        },
      ]),
    ).toMatchObject({ created: 1, createdForReview: 0 });
  });

  it('does not take another model of the brand for a similar name', () => {
    db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    ).run(
      'Smartphone Galaxy S23 Ultra',
      'Samsung Mobile',
      'Electronics',
      'smartphone galaxy s23 ultra',
    );

    expect(
      countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Brand: 'Samsung Mobile' }]),
    ).toMatchObject({ createdForReview: 1 });
    expect(similarReviews()).toEqual([[2, 'sameNameOtherBrand']]);
  });

  it('records both reasons when the name exists under another brand and is similar within its own', () => {
    db.prepare(
      'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
    ).run('Smartphne Galaxy S23', 'Samsung Mobile', 'Electronics', 'smartphne galaxy s23');

    const records: ImportRecord[] = [];
    sqliteImportCatalog(db).execute(
      [
        {
          Id: 'sku-1',
          SellerName: 'MegaStore',
          ...galaxy,
          Name: 'Smartphone Galaxy S23',
          Brand: 'Samsung Mobile',
        },
      ],
      (record) => records.push(record),
    );

    expect(records[0]).toMatchObject({
      outcome: 'createdForReview',
      reason: 'nameExistsWithOtherBrand',
    });
    expect(similarReviews()).toEqual(
      expect.arrayContaining([
        [2, 'sameNameOtherBrand'],
        [expect.any(Number), 'similarName'],
      ]),
    );
  });

  it('never looks for similar names when the entry matches a product', () => {
    expect(countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy }])).toMatchObject({
      linked: 1,
    });
    expect(similarReviews()).toEqual([]);
  });

  it('resolves the typo by merging: the misspelled name becomes an alias of the product', () => {
    const typo = { Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Name: 'Smarthpone Galaxy S23' };
    run([typo]);
    const duplicate = offersOf('MegaStore')[0]?.[1] as number;

    new MergeProducts(new CatalogDatabase(db)).execute(duplicate, 2);

    expect(countsOf([{ ...typo, Id: 'sku-2' }])).toMatchObject({ linked: 1, createdForReview: 0 });
    expect(offersOf('MegaStore')).toEqual([
      ['sku-1', 2],
      ['sku-2', 2],
    ]);
  });
});
