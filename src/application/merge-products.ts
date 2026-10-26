import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Use case: merge a duplicate product D into the right product P.
//
// D's offers move to P, D is marked as merged into P and every pending review about D ends
// as merged. D is kept, not deleted: the merge stays on record, and D's name and brand keep
// resolving to P on later imports. Any pair of active products can be merged, with or
// without a review, so older duplicates of the catalog can be fixed too.
export class MergeProducts {
  constructor(private readonly catalog: CatalogDatabase) {}

  execute(duplicateId: number, targetId: number): { movedOffers: number; resolvedReviews: number } {
    if (duplicateId === targetId) {
      throw new Error(`Cannot merge product ${duplicateId} into itself`);
    }
    return this.catalog.transaction(() => {
      this.requireActive(duplicateId, 'Duplicate');
      this.requireActive(targetId, 'Target');

      const movedOffers = this.catalog.moveOffers(duplicateId, targetId);
      this.catalog.markMerged(duplicateId, targetId);
      const resolvedReviews = this.catalog.resolveReviewsOf(duplicateId, 'merged');
      return { movedOffers, resolvedReviews };
    });
  }

  private requireActive(id: number, role: string): void {
    const product = this.catalog.findProductForMerge(id);
    if (!product) {
      throw new Error(`${role} product ${id} does not exist`);
    }
    if (product.mergedIntoId !== null) {
      throw new Error(`${role} product ${id} was already merged into ${product.mergedIntoId}`);
    }
  }
}
