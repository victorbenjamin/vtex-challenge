import { describe, expect, it } from 'vitest';
import { normalizeProductName } from '../../src/domain/product-name.ts';

describe('normalizeProductName', () => {
  it.each([
    ['repeated spaces', 'Smartphone  Galaxy S23', 'Smartphone Galaxy S23'],
    ['surrounding spaces', '  iPhone 15 Pro ', 'iPhone 15 Pro'],
    ['accents', 'Câmera Canon EOS R6', 'Camera Canon EOS R6'],
    ['case', 'IPHONE 15 PRO', 'iPhone 15 Pro'],
    ['two single quotes as inches', "Tablet iPad Pro 12.9''", 'Tablet iPad Pro 12.9"'],
    ['a missing inch mark', 'Tablet iPad Pro 12.9', 'Tablet iPad Pro 12.9"'],
    ['a missing inch mark after an integer', 'Smart TV Samsung 55', 'Smart TV Samsung 55"'],
  ])('treats %s as the same name', (_, variant, original) => {
    expect(normalizeProductName(variant)).toBe(normalizeProductName(original));
  });

  it.each([
    'Tablet iPad Pro 12.9',
    'Garden Tools Set 10-Piece',
    'Violin 4/4 Full Size',
    'Omega-3 Fish Oil',
  ])('keeps digits, dots, hyphens and slashes in %j', (name) => {
    expect(normalizeProductName(name)).toBe(name.toLowerCase());
  });

  it.each([
    ['Multivitamin Men', 'Multivitamin Women'],
    ['Compression Shirt', 'Compression Shorts'],
    ['Smartphone Galaxy S23', 'Smartphone Galaxy S24'],
    ['Smart TV Samsung 55"', 'Smart TV Samsung 65"'],
    ['Tablet iPad Pro 12.9"', 'Tablet iPad Pro 129"'],
  ])('keeps %j and %j apart', (a, b) => {
    expect(normalizeProductName(a)).not.toBe(normalizeProductName(b));
  });

  it('does not translate', () => {
    expect(normalizeProductName('Roteador WiFi 6 TP-Link')).not.toBe(
      normalizeProductName('Router WiFi 6 TP-Link'),
    );
  });
});
