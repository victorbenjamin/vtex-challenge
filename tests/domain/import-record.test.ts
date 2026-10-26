import { describe, expect, it } from 'vitest';
import { toImportRecord } from '../../src/domain/import-record.ts';
import { SellerProductEntry } from '../../src/domain/seller-product-entry.ts';

const entry = SellerProductEntry.parse({
  Id: 'sku-1',
  SellerName: 'MegaStore',
  Name: 'Smartphone Galaxy S23',
  Brand: null,
  Category: 'Electronics',
});

describe('toImportRecord', () => {
  it('puts position, outcome and reason first, then the item and the products', () => {
    const record = toImportRecord(3, {
      entry,
      outcome: 'conflict',
      reason: 'skuPointsToAnotherProduct',
      productId: 3,
      existingProductId: 2,
    });

    expect(Object.keys(record)).toEqual([
      'index',
      'outcome',
      'reason',
      'sellerName',
      'sellerProductId',
      'name',
      'brand',
      'productId',
      'existingProductId',
    ]);
    expect(record).toMatchObject({ sellerName: 'MegaStore', brand: null, existingProductId: 2 });
  });

  it('leaves out the item when it is invalid, and empty or absent details', () => {
    expect(
      toImportRecord(0, {
        outcome: 'unmatched',
        reason: 'tooManyCandidates',
        candidateProductIds: [],
        similarProductIds: undefined,
      }),
    ).toEqual({ index: 0, outcome: 'unmatched', reason: 'tooManyCandidates' });
  });

  it('copies the product lists', () => {
    const similarProductIds = [1, 2];
    const record = toImportRecord(0, {
      entry,
      outcome: 'createdForReview',
      reason: 'nameExistsWithOtherBrand',
      similarProductIds,
    });

    expect(record.similarProductIds).toEqual([1, 2]);
    expect(record.similarProductIds).not.toBe(similarProductIds);
  });
});
