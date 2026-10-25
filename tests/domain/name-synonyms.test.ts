import { describe, expect, it } from 'vitest';
import { NameSynonyms } from '../../src/domain/name-synonyms.ts';

const synonyms = new NameSynonyms([
  ['roteador', 'router'],
  ['processador', 'processor'],
]);

describe('NameSynonyms.translate', () => {
  it('translates a seller word into the catalog word', () => {
    expect(synonyms.translate('roteador wifi 6 tp-link')).toBe('router wifi 6 tp-link');
  });

  it('translates every known word of the name', () => {
    expect(synonyms.translate('roteador e processador')).toBe('router e processor');
  });

  it('leaves unknown words and names without synonyms unchanged', () => {
    expect(synonyms.translate('smartphone galaxy s23')).toBe('smartphone galaxy s23');
  });

  it('only translates whole words', () => {
    expect(synonyms.translate('processadores amd')).toBe('processadores amd');
    expect(synonyms.translate('microprocessador amd')).toBe('microprocessador amd');
  });

  it('normalizes terms and replacements however they were typed in', () => {
    const typedIn = new NameSynonyms([
      ['Câmera', 'CAMERA'],
      [' Teclado ', 'Keyboard'],
    ]);

    expect(typedIn.translate('camera digital')).toBe('camera digital');
    expect(typedIn.translate('teclado mecanico')).toBe('keyboard mecanico');
  });

  it('accepts a replacement with several words', () => {
    expect(new NameSynonyms([['notebook', 'laptop computer']]).translate('notebook dell')).toBe(
      'laptop computer dell',
    );
  });
});
