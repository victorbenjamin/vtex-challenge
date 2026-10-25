import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CANDIDATE_LIMIT } from '../../src/application/import-catalog.ts';
import { MARKETPLACE_SELLER_NAME } from '../../src/domain/seller-product-entry.ts';
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
    .all(sellerName);

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

  it('counts entries that no rule matches and writes nothing for them', () => {
    // A brand variant is not covered by name normalization.
    expect(
      countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Brand: 'Samsung Electronics' }]),
    ).toMatchObject({ linked: 0, unmatched: 1 });
    expect(externalSellers()).toEqual([]);
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

  it('rejects the marketplace seller name in any case', () => {
    expect(
      countsOf([
        { Id: 'sku-1', SellerName: MARKETPLACE_SELLER_NAME, ...galaxy },
        { Id: 'sku-2', SellerName: ` ${MARKETPLACE_SELLER_NAME.toUpperCase()} `, ...galaxy },
      ]),
    ).toMatchObject({ rejected: 2 });
    expect(offersOf(MARKETPLACE_SELLER_NAME)).toHaveLength(975);
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

  it('never links attributes shared by more than one catalog product', () => {
    const insert = db.prepare('INSERT INTO Product (Name, Brand, Category) VALUES (?, ?, ?)');
    insert.run('Yoga Mat Duplicate', 'Gaiam', 'Fitness');
    insert.run('Yoga Mat Duplicate', 'Gaiam', 'Fitness');

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
    ).toMatchObject({ linked: 0, unmatched: 1 });
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

  it('does not link a missing brand to a product that has one', () => {
    expect(
      countsOf([{ Id: 'sku-1', SellerName: 'MegaStore', ...galaxy, Brand: null }]),
    ).toMatchObject({ linked: 0, unmatched: 1 });
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

    it('still requires the brand after translating', () => {
      expect(countsOf([{ ...roteador, Brand: 'Netgear' }])).toMatchObject({
        linked: 0,
        unmatched: 1,
      });
    });

    it('uses a synonym added to the table on the next import', () => {
      const teclado = {
        Id: 'sku-2',
        SellerName: 'MegaStore',
        Name: 'Teclado Mechanical RGB',
        Brand: 'Corsair',
        Category: 'Accessories',
      };
      expect(countsOf([teclado])).toMatchObject({ unmatched: 1 });

      db.prepare('INSERT INTO NameSynonym (Term, Replacement) VALUES (?, ?)').run(
        'teclado',
        'keyboard',
      );

      // Catalog #7: Keyboard Mechanical RGB.
      expect(countsOf([teclado])).toMatchObject({ linked: 1 });
      expect(offersOf('MegaStore')).toEqual([['sku-2', 7]]);
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
