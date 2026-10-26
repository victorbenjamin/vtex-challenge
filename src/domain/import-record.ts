import type { SellerProductEntry } from './seller-product-entry.ts';

// What can happen to an item of an import file.
// `createdForReview` is a new product whose name exists in the catalog under another brand:
// it may duplicate an existing product, so it is recorded for review.
export type ItemOutcome =
  | 'linked'
  | 'alreadyLinked'
  | 'conflict'
  | 'created'
  | 'createdForReview'
  | 'unmatched'
  | 'rejected';

// What the import decided for one item. `failed` is not a decision but an error that
// stopped the import: the item was rolled back.
//
// `reason` is a short, stable value, so reports can be filtered by it:
// - linked, alreadyLinked: matchedByName, matchedByTranslatedName
// - conflict: skuPointsToAnotherProduct
// - created: nameNotInCatalog
// - createdForReview: nameExistsWithOtherBrand
// - unmatched: ambiguous, tooManyCandidates
// - rejected: what is invalid in the item, such as "Name must be non-empty text"
// - failed: the error that stopped the import
export interface ItemResult {
  outcome: ItemOutcome | 'failed';
  reason: string;
  // The item, when it is valid.
  entry?: SellerProductEntry | undefined;
  // The product the offer points to: matched, or created for the entry.
  productId?: number | undefined;
  // The product the seller's SKU already pointed to, on a conflict.
  existingProductId?: number | undefined;
  // The products that made the entry ambiguous.
  candidateProductIds?: readonly number[] | undefined;
  // The products a created product may duplicate, recorded for review.
  similarProductIds?: readonly number[] | undefined;
}

// One named constructor per result, so each outcome and its reason are written in one place.
export const ItemResult = {
  rejected: (rejection: string): ItemResult => ({ outcome: 'rejected', reason: rejection }),

  failed: (message: string): ItemResult => ({ outcome: 'failed', reason: message }),

  ambiguous: (entry: SellerProductEntry, candidateProductIds: readonly number[]): ItemResult => ({
    entry,
    outcome: 'unmatched',
    reason: 'ambiguous',
    candidateProductIds,
  }),

  tooManyCandidates: (entry: SellerProductEntry): ItemResult => ({
    entry,
    outcome: 'unmatched',
    reason: 'tooManyCandidates',
  }),

  // An offer of a product found by the entry's own name or by its translation. A conflict
  // keeps the product the seller's SKU already pointed to.
  offered: (
    entry: SellerProductEntry,
    outcome: 'linked' | 'alreadyLinked' | 'conflict',
    productId: number,
    matchedBy: 'name' | 'translatedName',
    existingProductId: number | undefined,
  ): ItemResult =>
    outcome === 'conflict'
      ? { entry, outcome, reason: 'skuPointsToAnotherProduct', productId, existingProductId }
      : {
          entry,
          outcome,
          reason: matchedBy === 'name' ? 'matchedByName' : 'matchedByTranslatedName',
          productId,
        },

  skuConflict: (entry: SellerProductEntry, existingProductId: number): ItemResult => ({
    entry,
    outcome: 'conflict',
    reason: 'skuPointsToAnotherProduct',
    existingProductId,
  }),

  created: (entry: SellerProductEntry, productId: number): ItemResult => ({
    entry,
    outcome: 'created',
    reason: 'nameNotInCatalog',
    productId,
  }),

  createdForReview: (
    entry: SellerProductEntry,
    productId: number,
    similarProductIds: readonly number[],
  ): ItemResult => ({
    entry,
    outcome: 'createdForReview',
    reason: 'nameExistsWithOtherBrand',
    productId,
    similarProductIds,
  }),
};

// One line of the import report: what happened to the item at `index` of the file, and why.
export interface ImportRecord {
  index: number;
  outcome: ItemOutcome | 'failed';
  reason: string;
  sellerName?: string;
  sellerProductId?: string;
  name?: string;
  brand?: string | null;
  productId?: number;
  existingProductId?: number;
  candidateProductIds?: number[];
  similarProductIds?: number[];
}

// The report line of an item: position, outcome and reason first, then the item and the
// products involved. Absent or empty details are left out, so each line only says what
// applies to it.
export function toImportRecord(index: number, result: ItemResult): ImportRecord {
  const { outcome, reason, entry, productId, existingProductId } = result;
  const { candidateProductIds = [], similarProductIds = [] } = result;
  return {
    index,
    outcome,
    reason,
    ...(entry
      ? {
          sellerName: entry.sellerName,
          sellerProductId: entry.sellerProductId,
          name: entry.name,
          brand: entry.brand,
        }
      : {}),
    ...(productId !== undefined ? { productId } : {}),
    ...(existingProductId !== undefined ? { existingProductId } : {}),
    ...(candidateProductIds.length > 0 ? { candidateProductIds: [...candidateProductIds] } : {}),
    ...(similarProductIds.length > 0 ? { similarProductIds: [...similarProductIds] } : {}),
  };
}
