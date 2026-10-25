import { describe, expect, it } from 'vitest';
import { Offer } from '../../src/domain/offer.ts';

const offer = new Offer(1, 'sku-1', 2);

describe('Offer.outcomeGiven', () => {
  it('is linked when the seller had no offer for the SKU', () => {
    expect(offer.outcomeGiven(undefined)).toBe('linked');
  });

  it('is already linked when the SKU points to the same product', () => {
    expect(offer.outcomeGiven(2)).toBe('alreadyLinked');
  });

  it('is a conflict when the SKU points to another product', () => {
    expect(offer.outcomeGiven(3)).toBe('conflict');
  });
});
