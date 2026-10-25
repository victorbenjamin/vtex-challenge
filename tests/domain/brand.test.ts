import { describe, expect, it } from 'vitest';
import { normalizeBrand } from '../../src/domain/brand.ts';

describe('normalizeBrand', () => {
  it.each([
    ["Levi's", 'Levis'],
    ['Amazon Basics', 'AmazonBasics'],
    ['BLACK+DECKER', 'Black+Decker'],
    ['simplehuman', 'Simplehuman'],
    ['Nestlé', 'Nestle'],
  ])('treats %j and %j as the same brand', (a, b) => {
    expect(normalizeBrand(a)).toBe(normalizeBrand(b));
  });

  it.each([
    ['Samsung', 'Samsung Electronics'],
    ['Nike', 'Adidas'],
    ['3M', '4M'],
  ])('keeps %j and %j apart', (a, b) => {
    expect(normalizeBrand(a)).not.toBe(normalizeBrand(b));
  });

  it('keeps a missing brand missing', () => {
    expect(normalizeBrand(null)).toBeNull();
  });

  it('does not turn a brand made only of punctuation into a missing brand', () => {
    expect(normalizeBrand('!!!')).toBe('');
    expect(normalizeBrand('!!!')).not.toBeNull();
  });
});
