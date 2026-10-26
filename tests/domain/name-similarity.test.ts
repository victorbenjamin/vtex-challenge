import { describe, expect, it } from 'vitest';
import { areSimilarNames } from '../../src/domain/name-similarity.ts';

describe('areSimilarNames', () => {
  it.each([
    ['a typo', 'smarthpone galaxy s23', 'smartphone galaxy s23'],
    ['another word order', 'galaxy s23 smartphone', 'smartphone galaxy s23'],
    ['a typo in another word order', 'galaxy s23 smartphnoe', 'smartphone galaxy s23'],
    ['a missing letter', 'keyboard mechanical rb', 'keyboard mechanical rgb'],
  ])('finds %s similar', (_, a, b) => {
    expect(areSimilarNames(a, b)).toBe(true);
  });

  it.each([
    ['another model number', 'smartphone galaxy s24', 'smartphone galaxy s23'],
    ['another size', 'smart tv samsung 65', 'smart tv samsung 55'],
    ['another decimal size', 'tablet ipad pro 11', 'tablet ipad pro 12.9'],
    ['a different product', 'yoga mat', 'smartphone galaxy s23'],
    ['the same name, which the name match handles', 'yoga mat', 'yoga mat'],
  ])('does not find %s similar', (_, a, b) => {
    expect(areSimilarNames(a, b)).toBe(false);
  });

  it('may raise a false alarm, which only costs a review', () => {
    expect(areSimilarNames('compression shirt', 'compression shorts')).toBe(true);
  });
});
