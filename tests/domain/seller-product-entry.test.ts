import { describe, expect, it } from 'vitest';
import { MARKETPLACE_SELLER_NAME as MIGRATION_MARKETPLACE_SELLER_NAME } from '../../migrations/002_marketplace_seller.ts';
import {
  MARKETPLACE_SELLER_NAME,
  SellerProductEntry,
} from '../../src/domain/seller-product-entry.ts';

const valid = {
  Id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
  SellerName: 'MegaStore',
  Name: 'Smartphone Galaxy S23',
  Brand: 'Samsung',
  Category: 'Electronics',
};

describe('SellerProductEntry.parse', () => {
  it('creates an entry from a valid item', () => {
    expect(SellerProductEntry.parse(valid)).toMatchObject({
      sellerProductId: valid.Id,
      sellerName: 'MegaStore',
      name: 'Smartphone Galaxy S23',
      brand: 'Samsung',
      category: 'Electronics',
    });
  });

  it('keeps the product name exactly as received', () => {
    expect(SellerProductEntry.parse({ ...valid, Name: 'Smartphone  Galaxy S23' })?.name).toBe(
      'Smartphone  Galaxy S23',
    );
  });

  it('trims the seller name', () => {
    expect(SellerProductEntry.parse({ ...valid, SellerName: ' MegaStore ' })?.sellerName).toBe(
      'MegaStore',
    );
  });

  it('accepts null or missing brand and category', () => {
    expect(SellerProductEntry.parse({ ...valid, Brand: null })).toMatchObject({ brand: null });
    expect(
      SellerProductEntry.parse({ Id: 'x', SellerName: 'MegaStore', Name: 'Rug' }),
    ).toMatchObject({ brand: null, category: null });
  });

  it.each(['09835342345-4678-9abc-def012345678', 'uddd0000-eeee-4111-ffff-aaaa22223333', '42'])(
    'accepts the seller id %s in any non-empty format',
    (Id) => {
      expect(SellerProductEntry.parse({ ...valid, Id })?.sellerProductId).toBe(Id);
    },
  );

  it.each([
    ['Id', ''],
    ['Id', '   '],
    ['Id', 123],
    ['SellerName', ''],
    ['SellerName', null],
    ['Name', undefined],
    ['Brand', 1],
    ['Category', ['Electronics']],
  ])('rejects %s = %j', (field, value) => {
    expect(SellerProductEntry.parse({ ...valid, [field]: value })).toBeUndefined();
  });

  it.each([null, 'text', [valid]])('rejects %j because it is not an object', (raw) => {
    expect(SellerProductEntry.parse(raw)).toBeUndefined();
  });
});

describe('SellerProductEntry.isFromMarketplace', () => {
  it.each(['Marketplace', 'marketplace', ' MARKETPLACE '])('is true for %j', (SellerName) => {
    expect(SellerProductEntry.parse({ ...valid, SellerName })?.isFromMarketplace()).toBe(true);
  });

  it('is false for other sellers', () => {
    expect(
      SellerProductEntry.parse({ ...valid, SellerName: 'Marketplace Store' })?.isFromMarketplace(),
    ).toBe(false);
  });

  it('uses the same marketplace name as migration 002', () => {
    expect(MARKETPLACE_SELLER_NAME).toBe(MIGRATION_MARKETPLACE_SELLER_NAME);
  });
});
