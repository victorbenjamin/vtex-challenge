import type { NameSynonyms } from '../domain/name-synonyms.ts';
import type { SellerProductEntry } from '../domain/seller-product-entry.ts';
import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Most normalized names belong to a single product. Reaching this many candidates means
// the name is too generic to decide by brand alone.
export const CANDIDATE_LIMIT = 50;

// The catalog product an entry refers to, if it can be told.
// - found: the only product of the entry's name and brand;
// - ambiguous: several products of the entry's name and brand;
// - tooManyCandidates: the name is too generic to check every product of it;
// - notFound: no product of the entry's brand. `similarProductIds` are the products with the
//   name under another brand, which a product created for the entry may duplicate.
export type ProductMatch =
  | { kind: 'found'; productId: number; matchedBy: 'name' | 'translatedName' }
  | { kind: 'ambiguous'; candidateProductIds: number[] }
  | { kind: 'tooManyCandidates' }
  | { kind: 'notFound'; similarProductIds: number[] };

// Finds the catalog product of an entry by name and brand, both compared up to spelling
// (category is not compared: sellers spell it unreliably). The entry's own name comes first;
// its translation to the catalog's vocabulary is tried only when the own name finds no
// product of the entry's brand. Precision comes before recall: an ambiguous name stops here.
export class ProductMatcher {
  constructor(
    private readonly catalog: CatalogDatabase,
    private readonly synonyms: NameSynonyms,
  ) {}

  match(entry: SellerProductEntry): ProductMatch {
    const byOwnName = this.matchName(entry.normalizedName, entry, 'name');
    const translatedName = this.synonyms.translate(entry.normalizedName);
    if (byOwnName.kind !== 'notFound' || translatedName === entry.normalizedName) {
      return byOwnName;
    }
    const byTranslatedName = this.matchName(translatedName, entry, 'translatedName');
    if (byTranslatedName.kind !== 'notFound') {
      return byTranslatedName;
    }
    return {
      kind: 'notFound',
      similarProductIds: [...byOwnName.similarProductIds, ...byTranslatedName.similarProductIds],
    };
  }

  private matchName(
    normalizedName: string,
    entry: SellerProductEntry,
    matchedBy: 'name' | 'translatedName',
  ): ProductMatch {
    const candidates = this.catalog.findProductsByNormalizedName(normalizedName, CANDIDATE_LIMIT);
    if (candidates.length === CANDIDATE_LIMIT) {
      return { kind: 'tooManyCandidates' };
    }
    // Candidates are distinct product ids: a merged product resolves to the one it was
    // merged into, so it may appear twice without being ambiguous.
    const distinctIds = (products: { id: number }[]) => [...new Set(products.map(({ id }) => id))];
    const matches = distinctIds(candidates.filter((candidate) => entry.hasBrand(candidate.brand)));
    const [match, another] = matches;
    if (match === undefined) {
      return { kind: 'notFound', similarProductIds: distinctIds(candidates) };
    }
    return another === undefined
      ? { kind: 'found', productId: match, matchedBy }
      : { kind: 'ambiguous', candidateProductIds: matches };
  }
}
