import type Database from 'better-sqlite3';
import { NameSynonyms } from '../../domain/name-synonyms.ts';
import type { Offer } from '../../domain/offer.ts';
import type { SellerProductEntry } from '../../domain/seller-product-entry.ts';

// Why a created product was recorded for review (see migration 007).
export type ProductReviewReason = 'sameNameOtherBrand';

// All the SQL the import needs. Every query is parameterized (the import file carries
// seller-provided text) and looks rows up by key or index, never by loading a whole table.
// Writes are insert-if-absent, so concurrent imports are arbitrated by the database.
export class CatalogDatabase {
  constructor(private readonly db: Database.Database) {}

  // Commits when the work returns, rolls back when it throws.
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  // All synonyms sellers' words have in the catalog's vocabulary. The table is
  // configuration-sized, unlike Product, so reading it whole is fine.
  loadNameSynonyms(): NameSynonyms {
    const rows = this.db.prepare('SELECT Term, Replacement FROM NameSynonym').raw().all() as [
      string,
      string,
    ][];
    return new NameSynonyms(rows);
  }

  // Up to `limit` products whose name is the given normalized name, with their brand for
  // the caller to compare. Served by the NormalizedName prefix of
  // IX_Product_NormalizedName_Brand_Category, which also covers Brand.
  findProductsByNormalizedName(
    normalizedName: string,
    limit: number,
  ): { id: number; brand: string | null }[] {
    return this.db
      .prepare('SELECT Id AS id, Brand AS brand FROM Product WHERE NormalizedName = ? LIMIT ?')
      .all(normalizedName, limit) as { id: number; brand: string | null }[];
  }

  // A product new to the catalog, as the seller described it. NormalizedName is set so that
  // later entries find it (see migration 004).
  createProduct({ name, brand, category, normalizedName }: SellerProductEntry): number {
    return Number(
      this.db
        .prepare('INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)')
        .run(name, brand, category, normalizedName).lastInsertRowid,
    );
  }

  // The product the seller's SKU points to, if the seller already offers that SKU.
  findOfferProductId(sellerId: number, sellerProductId: string): number | undefined {
    return this.db
      .prepare('SELECT ProductId FROM SellerProduct WHERE SellerId = ? AND SellerProductId = ?')
      .pluck()
      .get(sellerId, sellerProductId) as number | undefined;
  }

  // Records that a product may duplicate each of the given ones, for a reviewer to decide.
  addProductReviews(
    productId: number,
    similarProductIds: readonly number[],
    reason: ProductReviewReason,
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO ProductReview (ProductId, SimilarProductId, Reason) VALUES (?, ?, ?)
       ON CONFLICT (ProductId, SimilarProductId) DO NOTHING`,
    );
    for (const similarProductId of similarProductIds) {
      insert.run(productId, similarProductId, reason);
    }
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
