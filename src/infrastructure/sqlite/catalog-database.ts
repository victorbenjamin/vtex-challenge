import type Database from 'better-sqlite3';
import type { Offer } from '../../domain/offer.ts';
import type { SellerProductEntry } from '../../domain/seller-product-entry.ts';

// All the SQL the import needs. Every query is parameterized (the import file carries
// seller-provided text) and looks rows up by key or index, never by loading a whole table.
// Writes are insert-if-absent, so concurrent imports are arbitrated by the database.
export class CatalogDatabase {
  constructor(private readonly db: Database.Database) {}

  // Commits when the work returns, rolls back when it throws.
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  // Up to `limit` products whose name is the entry's up to spelling (accents, case, inch
  // marks, spacing), with the same brand and category. IS treats null as equal to null;
  // the lookup is served by IX_Product_NormalizedName_Brand_Category.
  findProductIdsByNormalizedName(
    { normalizedName, brand, category }: SellerProductEntry,
    limit: number,
  ): number[] {
    return this.db
      .prepare(
        'SELECT Id FROM Product WHERE NormalizedName = ? AND Brand IS ? AND Category IS ? LIMIT ?',
      )
      .pluck()
      .all(normalizedName, brand, category, limit) as number[];
  }

  // The Name column is COLLATE NOCASE: a seller is found regardless of case. If another
  // import creates the same seller concurrently, both end up with the same id.
  findOrCreateSeller(name: string): number {
    this.db.prepare('INSERT INTO Seller (Name) VALUES (?) ON CONFLICT (Name) DO NOTHING').run(name);
    return this.db.prepare('SELECT Id FROM Seller WHERE Name = ?').pluck().get(name) as number;
  }

  // Stores the offer unless the seller already has one for the same SKU. Returns the
  // product that SKU already pointed to, or undefined when this offer was stored.
  addOfferIfAbsent({ sellerId, sellerProductId, productId }: Offer): number | undefined {
    const { changes } = this.db
      .prepare(
        `INSERT INTO SellerProduct (SellerId, SellerProductId, ProductId) VALUES (?, ?, ?)
         ON CONFLICT (SellerId, SellerProductId) DO NOTHING`,
      )
      .run(sellerId, sellerProductId, productId);
    if (changes === 1) {
      return undefined;
    }
    return this.db
      .prepare('SELECT ProductId FROM SellerProduct WHERE SellerId = ? AND SellerProductId = ?')
      .pluck()
      .get(sellerId, sellerProductId) as number;
  }
}
