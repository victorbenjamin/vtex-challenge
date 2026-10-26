import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Use case: a reviewer decides that two products under review are different products.
// The pending review of the pair ends as distinct; products and offers do not change.
export class MarkDistinct {
  constructor(private readonly catalog: CatalogDatabase) {}

  execute(productId: number, similarProductId: number): void {
    this.catalog.transaction(() => {
      if (this.catalog.markReviewDistinct(productId, similarProductId) === 0) {
        throw new Error(
          `There is no pending review of products ${productId} and ${similarProductId}`,
        );
      }
    });
  }
}
