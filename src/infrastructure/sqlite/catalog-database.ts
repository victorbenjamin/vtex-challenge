import type Database from 'better-sqlite3';
import { NameSynonyms } from '../../domain/name-synonyms.ts';
import type { Offer } from '../../domain/offer.ts';
import type { SellerProductEntry } from '../../domain/seller-product-entry.ts';

// Why a created product was recorded for review, and how a review ends (see migration 007).
export type ProductReviewReason = 'sameNameOtherBrand' | 'similarName';
export type ProductReviewResolution = 'merged' | 'distinct';

export interface PendingReview {
  id: number;
  productId: number;
  product: string;
  similarProductId: number;
  similarProduct: string;
  createdAt: string;
}

// All the SQL the import needs. Every query is parameterized (the import file carries
// seller-provided text) and looks rows up by key or index, never by loading a whole table.
// Writes are insert-if-absent, so concurrent imports are arbitrated by the database.
export class CatalogDatabase {
  // Each SQL text is prepared once per connection and reused. Preparing on every call
  // creates a native statement each time, freed only when JavaScript collects garbage, so
  // memory grew with the size of the import file (see docs/analysis/performance-and-scale.md).
  private readonly statements = new Map<string, Database.Statement>();

  constructor(private readonly db: Database.Database) {}

  private statement(sql: string): Database.Statement {
    let statement = this.statements.get(sql);
    if (statement === undefined) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  // Commits when the work returns, rolls back when it throws.
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  // All synonyms sellers' words have in the catalog's vocabulary. The table is
  // configuration-sized, unlike Product, so reading it whole is fine.
  loadNameSynonyms(): NameSynonyms {
    const rows = this.statement('SELECT Term, Replacement FROM NameSynonym').raw().all() as [
      string,
      string,
    ][];
    return new NameSynonyms(rows);
  }

  // Up to `limit` products whose name is the given normalized name, with their brand for
  // the caller to compare. A product merged into another resolves to it: its name and brand
  // stay known, as an alias of the product it was merged into. Served by the NormalizedName
  // prefix of IX_Product_NormalizedName_Brand_Category.
  findProductsByNormalizedName(
    normalizedName: string,
    limit: number,
  ): { id: number; brand: string | null }[] {
    return this.statement(
      `SELECT coalesce(MergedIntoId, Id) AS id, Brand AS brand
         FROM Product WHERE NormalizedName = ? LIMIT ?`,
    ).all(normalizedName, limit) as { id: number; brand: string | null }[];
  }

  // A product new to the catalog, as the seller described it. NormalizedName is set so that
  // later entries find it (see migration 004).
  createProduct({ name, brand, category, normalizedName }: SellerProductEntry): number {
    return Number(
      this.statement(
        'INSERT INTO Product (Name, Brand, Category, NormalizedName) VALUES (?, ?, ?, ?)',
      ).run(name, brand, category, normalizedName).lastInsertRowid,
    );
  }

  // Up to `limit` active (not merged) products of a brand, compared ignoring case, with
  // their normalized names. A missing brand finds the products without a brand. Served by
  // IX_Product_Brand.
  findActiveProductsOfBrand(
    brand: string | null,
    limit: number,
  ): { id: number; normalizedName: string }[] {
    const sql = `SELECT Id AS id, NormalizedName AS normalizedName FROM Product
      WHERE ${brand === null ? 'Brand IS NULL' : 'Brand = ? COLLATE NOCASE'}
        AND MergedIntoId IS NULL
      LIMIT ?`;
    const parameters = brand === null ? [limit] : [brand, limit];
    return this.statement(sql).all(...parameters) as { id: number; normalizedName: string }[];
  }

  // The product the seller's SKU points to, if the seller already offers that SKU.
  findOfferProductId(sellerId: number, sellerProductId: string): number | undefined {
    return this.statement(
      'SELECT ProductId FROM SellerProduct WHERE SellerId = ? AND SellerProductId = ?',
    )
      .pluck()
      .get(sellerId, sellerProductId) as number | undefined;
  }

  // Records that a product may duplicate each of the given ones, for a reviewer to decide.
  addProductReviews(
    productId: number,
    similarProductIds: readonly number[],
    reason: ProductReviewReason,
  ): void {
    const insert = this.statement(
      `INSERT INTO ProductReview (ProductId, SimilarProductId, Reason) VALUES (?, ?, ?)
       ON CONFLICT (ProductId, SimilarProductId) DO NOTHING`,
    );
    for (const similarProductId of similarProductIds) {
      insert.run(productId, similarProductId, reason);
    }
  }

  // The product with this id and the product it was merged into, if any.
  findProductForMerge(id: number): { id: number; mergedIntoId: number | null } | undefined {
    return this.statement(
      'SELECT Id AS id, MergedIntoId AS mergedIntoId FROM Product WHERE Id = ?',
    ).get(id) as { id: number; mergedIntoId: number | null } | undefined;
  }

  // Points every offer of one product to another. Returns how many offers moved. The key
  // of SellerProduct is (SellerId, SellerProductId), so no offer can collide.
  moveOffers(fromProductId: number, toProductId: number): number {
    return this.statement('UPDATE SellerProduct SET ProductId = ? WHERE ProductId = ?').run(
      toProductId,
      fromProductId,
    ).changes;
  }

  // Marks a product as merged into another, and repoints the products previously merged
  // into it, so MergedIntoId always points to an active product.
  markMerged(duplicateId: number, targetId: number): void {
    this.statement('UPDATE Product SET MergedIntoId = ? WHERE Id = ?').run(targetId, duplicateId);
    this.statement('UPDATE Product SET MergedIntoId = ? WHERE MergedIntoId = ?').run(
      targetId,
      duplicateId,
    );
  }

  // Ends every pending review that mentions the product. Returns how many ended.
  resolveReviewsOf(productId: number, resolution: ProductReviewResolution): number {
    return this.statement(
      `UPDATE ProductReview SET Status = ?
         WHERE Status = 'pending' AND (ProductId = ? OR SimilarProductId = ?)`,
    ).run(resolution, productId, productId).changes;
  }

  // Ends the pending review of a pair, in either direction. Returns how many ended.
  markReviewDistinct(productId: number, similarProductId: number): number {
    return this.statement(
      `UPDATE ProductReview SET Status = 'distinct'
         WHERE Status = 'pending'
           AND ((ProductId = ? AND SimilarProductId = ?) OR (ProductId = ? AND SimilarProductId = ?))`,
    ).run(productId, similarProductId, similarProductId, productId).changes;
  }

  listPendingReviews(): PendingReview[] {
    return this.statement(
      `SELECT r.Id AS id,
                p.Id AS productId, p.Name || ' / ' || coalesce(p.Brand, '-') AS product,
                s.Id AS similarProductId, s.Name || ' / ' || coalesce(s.Brand, '-') AS similarProduct,
                r.CreatedAt AS createdAt
         FROM ProductReview r
         JOIN Product p ON p.Id = r.ProductId
         JOIN Product s ON s.Id = r.SimilarProductId
         WHERE r.Status = 'pending'
         ORDER BY r.Id`,
    ).all() as PendingReview[];
  }

  // The Name column is COLLATE NOCASE: a seller is found regardless of case. If another
  // import creates the same seller concurrently, both end up with the same id.
  findOrCreateSeller(name: string): number {
    this.statement('INSERT INTO Seller (Name) VALUES (?) ON CONFLICT (Name) DO NOTHING').run(name);
    return this.statement('SELECT Id FROM Seller WHERE Name = ?').pluck().get(name) as number;
  }

  // Stores the offer unless the seller already has one for the same SKU. Returns the
  // product that SKU already pointed to, or undefined when this offer was stored.
  addOfferIfAbsent({ sellerId, sellerProductId, productId }: Offer): number | undefined {
    const { changes } = this.statement(
      `INSERT INTO SellerProduct (SellerId, SellerProductId, ProductId) VALUES (?, ?, ?)
         ON CONFLICT (SellerId, SellerProductId) DO NOTHING`,
    ).run(sellerId, sellerProductId, productId);
    if (changes === 1) {
      return undefined;
    }
    return this.statement(
      'SELECT ProductId FROM SellerProduct WHERE SellerId = ? AND SellerProductId = ?',
    )
      .pluck()
      .get(sellerId, sellerProductId) as number;
  }
}
