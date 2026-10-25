import { normalizeProductName } from './product-name.ts';

// Words sellers use, mapped to the words the catalog uses ("roteador" -> "router").
// Translation goes one way, from a seller's vocabulary to the catalog's, and whole words
// only: "processador" is translated, "processadores" is not.
export class NameSynonyms {
  private readonly replacements: ReadonlyMap<string, string>;

  // Terms and replacements are normalized here, so they compare with normalized names
  // however they were typed in.
  constructor(synonyms: Iterable<readonly [term: string, replacement: string]>) {
    this.replacements = new Map(
      [...synonyms].map(([term, replacement]) => [
        normalizeProductName(term),
        normalizeProductName(replacement),
      ]),
    );
  }

  translate(normalizedName: string): string {
    return normalizedName
      .split(' ')
      .map((word) => this.replacements.get(word) ?? word)
      .join(' ');
  }
}
